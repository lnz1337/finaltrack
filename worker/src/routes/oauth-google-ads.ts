import type { Env } from '../types';
import { buildConsentUrl, exchangeCodeForTokens } from '../lib/google-ads/oauth';
import { signState, verifyState } from '../lib/google-ads/oauth-state';
import { listAccessibleCustomers } from '../lib/google-ads/client';
import { createSupabaseClient } from '../lib/supabase';
import { encryptAesGcm, decryptAesGcm } from '../lib/crypto';
import { formatCustomerId } from '../lib/customer-id';
import { validateInternalRequest } from '../lib/internal-auth';

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
  const url = new URL(req.url);
  if (url.searchParams.get('error') === 'access_denied') {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'user_cancelled' });
  }
  const stateQuery = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const stateCookie = readCookie(req, 'lt_oauth_state');

  if (!stateCookie) return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'state_missing' });
  const payload = await verifyState(stateQuery, stateCookie, env.ENCRYPTION_KEY);
  if (!payload) {
    const reason = stateQuery === stateCookie ? 'state_invalid' : 'state_mismatch';
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason });
  }
  if (!code) return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'code_exchange_failed' });

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens({
      code, clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
      redirectUri: env.GOOGLE_ADS_OAUTH_REDIRECT_URI,
    });
  } catch {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'code_exchange_failed' });
  }

  let customerIds: string[];
  try {
    customerIds = await listAccessibleCustomers({
      accessToken: tokens.access_token, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });
  } catch {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
  }
  if (customerIds.length === 0) {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'no_accounts' });
  }

  const sb = createSupabaseClient(env);

  if (customerIds.length === 1) {
    const { ciphertext, iv } = await encryptAesGcm(env.ENCRYPTION_KEY, tokens.refresh_token);
    try {
      await sb.upsert('google_ads_accounts', [{
        workspace_id: payload.workspace_id,
        customer_id: customerIds[0],
        account_name: defaultAccountName(customerIds[0]),
        refresh_token_encrypted: ciphertext,
        refresh_token_iv: iv,
        is_active: true,
      }], { onConflict: 'workspace_id,customer_id' });
    } catch {
      return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
    }
    return appRedirect(env, '/dashboard/integrations', { status: 'connected' });
  }

  // 2+ customers → grava pending + redirect /select
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
  if (!rows[0]) {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
  }
  return appRedirect(env, '/dashboard/integrations/select', { session: rows[0].id });
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
