import type { Env } from '../types';
import { buildConsentUrl, exchangeCodeForTokens } from '../lib/google-ads/oauth';
import { signState, verifyState } from '../lib/google-ads/oauth-state';
import { listAccessibleCustomers } from '../lib/google-ads/client';
import { createSupabaseClient } from '../lib/supabase';
import { encryptAesGcm, decryptAesGcm } from '../lib/crypto';
import { formatCustomerId } from '../lib/customer-id';
import { validateInternalRequest } from '../lib/internal-auth';
import { createStructuredLogger } from '../lib/structured-log';

// Schema padronizado pra falhas de step no fluxo OAuth (decisão 4.9.4).
function stepErr(step: string, err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { step, error_message: err.message, error_name: err.name, error_stack: err.stack };
  }
  return { step, error_message: String(err), error_name: 'NonError' };
}

export async function handleOAuthStart(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) return new Response('missing workspace_id', { status: 400 });

  const state = await signState({ workspace_id: workspaceId }, env.ENCRYPTION_KEY, 600);
  const consentUrl = buildConsentUrl({
    clientId: env.GOOGLE_ADS_CLIENT_ID,
    redirectUri: env.GOOGLE_ADS_OAUTH_REDIRECT_URI,
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: consentUrl,
      'Set-Cookie': `lt_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/oauth/google-ads`,
    },
  });
}

function appRedirect(env: Env, path: string, params: Record<string, string>): Response {
  const url = new URL(path, env.APP_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': 'lt_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/oauth/google-ads',
    },
  });
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// Decisão 3.A.2.5: account_name default = 'Conta ' || formatCustomerId(customer_id).
function defaultAccountName(customerId: string): string {
  return `Conta ${formatCustomerId(customerId)}`;
}

export async function handleOAuthCallback(req: Request, env: Env): Promise<Response> {
  const log = createStructuredLogger(crypto.randomUUID(), Date.now());
  const url = new URL(req.url);
  if (url.searchParams.get('error') === 'access_denied') {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'user_cancelled' });
  }
  const stateQuery = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const stateCookie = readCookie(req, 'lt_oauth_state');

  if (!stateCookie) return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'state_missing' });
  let payload: Awaited<ReturnType<typeof verifyState>>;
  try {
    payload = await verifyState(stateQuery, stateCookie, env.ENCRYPTION_KEY);
  } catch (err) {
    log.error('callback_step_failed', stepErr('verify_state', err));
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'state_invalid' });
  }
  if (!payload) {
    const reason = stateQuery === stateCookie ? 'state_invalid' : 'state_mismatch';
    log.warn('callback_state_rejected', { reason });
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason });
  }
  if (!code) return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'code_exchange_failed' });

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens({
      code, clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
      redirectUri: env.GOOGLE_ADS_OAUTH_REDIRECT_URI,
    });
  } catch (err) {
    log.error('callback_step_failed', stepErr('exchange_code', err));
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'code_exchange_failed' });
  }

  let customerIds: string[];
  try {
    customerIds = await listAccessibleCustomers({
      accessToken: tokens.access_token, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });
  } catch (err) {
    log.error('callback_step_failed', stepErr('list_customers', err));
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
  }
  if (customerIds.length === 0) {
    log.warn('callback_no_accessible_customers', {});
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'no_accounts' });
  }

  const sb = createSupabaseClient(env);

  if (customerIds.length === 1) {
    let ciphertext: string, iv: string;
    try {
      ({ ciphertext, iv } = await encryptAesGcm(env.ENCRYPTION_KEY, tokens.refresh_token));
    } catch (err) {
      log.error('callback_step_failed', stepErr('encrypt_tokens', err));
      return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
    }
    try {
      await sb.upsert('google_ads_accounts', [{
        workspace_id: payload.workspace_id,
        customer_id: customerIds[0],
        account_name: defaultAccountName(customerIds[0]),
        refresh_token_encrypted: ciphertext,
        refresh_token_iv: iv,
        is_active: true,
      }], { onConflict: 'workspace_id,customer_id' });
    } catch (err) {
      log.error('callback_step_failed', { ...stepErr('upsert_account', err), workspace_id: payload.workspace_id, customer_id: customerIds[0] });
      return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
    }
    log.info('callback_account_connected', { workspace_id: payload.workspace_id, customer_id: customerIds[0] });
    return appRedirect(env, '/dashboard/integrations', { status: 'connected' });
  }

  // 2+ customers → grava pending + redirect /select
  let pendingId: string | undefined;
  try {
    const payloadJson = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      customer_ids: customerIds,
    });
    const { ciphertext, iv } = await encryptAesGcm(env.ENCRYPTION_KEY, payloadJson);
    await sb.insert('oauth_pending_selections', {
      workspace_id: payload.workspace_id,
      encrypted_payload: ciphertext,
      payload_iv: iv,
    });
    const rows = await sb.select<{ id: string }>('oauth_pending_selections', {
      workspace_id: `eq.${payload.workspace_id}`, encrypted_payload: `eq.${ciphertext}`,
      select: 'id', limit: '1', order: 'created_at.desc',
    });
    pendingId = rows[0]?.id;
  } catch (err) {
    log.error('callback_step_failed', { ...stepErr('upsert_pending', err), workspace_id: payload.workspace_id });
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
  }
  if (!pendingId) {
    log.error('callback_step_failed', { step: 'upsert_pending', error_message: 'no row returned after insert', error_name: 'NoRow', workspace_id: payload.workspace_id });
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
  }
  log.info('callback_pending_created', { workspace_id: payload.workspace_id, session_id: pendingId, customer_count: customerIds.length });
  return appRedirect(env, '/dashboard/integrations/select', { session: pendingId });
}

export async function handleOAuthPreview(req: Request, env: Env, sessionUuid: string): Promise<Response> {
  let auth: Awaited<ReturnType<typeof validateInternalRequest>>;
  try {
    auth = await validateInternalRequest(req, env);
  } catch (resp) {
    return resp as Response;
  }

  const sb = createSupabaseClient(env);
  const rows = await sb.select<{
    id: string; workspace_id: string; encrypted_payload: string; payload_iv: string; expires_at: string;
  }>('oauth_pending_selections', {
    id: `eq.${sessionUuid}`,
    select: 'id,workspace_id,encrypted_payload,payload_iv,expires_at',
    limit: '1',
  });

  if (!rows[0]) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  if (!auth.workspaceIds.includes(rows[0].workspace_id)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }
  if (new Date(rows[0].expires_at).getTime() < Date.now()) {
    await sb.delete('oauth_pending_selections', { id: `eq.${rows[0].id}` });
    return new Response(JSON.stringify({ error: 'gone' }), { status: 410 });
  }

  const decrypted = await decryptAesGcm(env.ENCRYPTION_KEY, rows[0].encrypted_payload, rows[0].payload_iv);
  const payload = JSON.parse(decrypted) as { customer_ids: string[] };

  return new Response(JSON.stringify({
    session_id: rows[0].id,
    customer_ids: payload.customer_ids,
    expires_at: rows[0].expires_at,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

export async function handleOAuthFinalize(req: Request, env: Env): Promise<Response> {
  const log = createStructuredLogger(crypto.randomUUID(), Date.now());
  let auth: Awaited<ReturnType<typeof validateInternalRequest>>;
  try {
    auth = await validateInternalRequest(req, env);
  } catch (resp) {
    return resp as Response;
  }

  const body = (await req.json().catch(() => null)) as { session_uuid?: string; customer_ids?: string[] } | null;
  if (!body?.session_uuid || !Array.isArray(body.customer_ids) || body.customer_ids.length === 0) {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 });
  }

  const sb = createSupabaseClient(env);
  let rows: Array<{ id: string; workspace_id: string; encrypted_payload: string; payload_iv: string; expires_at: string }>;
  try {
    rows = await sb.select('oauth_pending_selections', { id: `eq.${body.session_uuid}`, select: '*', limit: '1' });
  } catch (err) {
    log.error('finalize_step_failed', stepErr('select_pending', err));
    return new Response(JSON.stringify({ error: 'db_error' }), { status: 500 });
  }

  if (!rows[0] || !auth.workspaceIds.includes(rows[0].workspace_id)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }
  if (new Date(rows[0].expires_at).getTime() < Date.now()) {
    await sb.delete('oauth_pending_selections', { id: `eq.${rows[0].id}` });
    return new Response(JSON.stringify({ error: 'gone' }), { status: 410 });
  }

  let payload: { refresh_token: string; customer_ids: string[] };
  try {
    const decrypted = await decryptAesGcm(env.ENCRYPTION_KEY, rows[0].encrypted_payload, rows[0].payload_iv);
    payload = JSON.parse(decrypted);
  } catch (err) {
    log.error('finalize_step_failed', { ...stepErr('decrypt_pending', err), session_uuid: body.session_uuid });
    return new Response(JSON.stringify({ error: 'db_error' }), { status: 500 });
  }

  // Filtra só customer_ids selecionados que estão na lista original (defensiva)
  const valid = body.customer_ids.filter((id) => payload.customer_ids.includes(id));
  if (valid.length === 0) {
    return new Response(JSON.stringify({ error: 'invalid_customer_ids' }), { status: 400 });
  }

  try {
    // Encrypt refresh_token uma vez por account inserted. account_name default por decisão 3.A.2.5.
    const accountsToInsert = await Promise.all(valid.map(async (customerId) => {
      const { ciphertext, iv } = await encryptAesGcm(env.ENCRYPTION_KEY, payload.refresh_token);
      return {
        workspace_id: rows[0].workspace_id,
        customer_id: customerId,
        account_name: defaultAccountName(customerId),
        refresh_token_encrypted: ciphertext,
        refresh_token_iv: iv,
        is_active: true,
      };
    }));
    await sb.upsert('google_ads_accounts', accountsToInsert, { onConflict: 'workspace_id,customer_id' });
  } catch (err) {
    log.error('finalize_step_failed', { ...stepErr('upsert_accounts', err), workspace_id: rows[0].workspace_id, customer_ids: valid });
    return new Response(JSON.stringify({ error: 'db_error' }), { status: 500 });
  }

  // Limpa pending (não-fatal se falhar — só loga)
  try {
    await sb.delete('oauth_pending_selections', { id: `eq.${rows[0].id}` });
  } catch (err) {
    log.warn('finalize_step_failed', { ...stepErr('delete_pending', err), session_uuid: body.session_uuid });
  }

  log.info('finalize_accounts_created', { workspace_id: rows[0].workspace_id, accounts_created: valid.length });
  return new Response(JSON.stringify({ accounts_created: valid.length }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}
