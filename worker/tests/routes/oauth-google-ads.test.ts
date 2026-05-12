import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { handleOAuthStart, handleOAuthCallback, handleOAuthPreview } from '../../src/routes/oauth-google-ads';
import { signState } from '../../src/lib/google-ads/oauth-state';
import * as oauth from '../../src/lib/google-ads/oauth';
import * as client from '../../src/lib/google-ads/client';
import { createSupabaseClient } from '../../src/lib/supabase';
import * as internalAuth from '../../src/lib/internal-auth';
import { encryptAesGcm } from '../../src/lib/crypto';

describe('GET /oauth/google-ads/start', () => {
  it('400 quando workspace_id ausente', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/start');
    const res = await handleOAuthStart(req, env);
    expect(res.status).toBe(400);
  });

  it('302 + Set-Cookie + Location pra Google quando workspace_id válido', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/start?workspace_id=00000000-0000-0000-0000-000000000001');
    const res = await handleOAuthStart(req, env);
    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('lt_oauth_state=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=600');
    expect(setCookie).toContain('Path=/oauth/google-ads');
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('access_type=offline');
    expect(location).toContain('prompt=consent');
  });
});

const APP_BASE = 'http://localhost:3000';

describe('GET /oauth/google-ads/callback', () => {
  beforeEach(() => {
    Object.assign(env, { APP_BASE_URL: APP_BASE });
  });
  afterEach(() => vi.restoreAllMocks());

  it('?error=access_denied → redirect status=user_cancelled', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/callback?error=access_denied');
    const res = await handleOAuthCallback(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('status=oauth_error&reason=user_cancelled');
  });

  it('state ausente no cookie → redirect oauth_error reason=state_missing', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/callback?code=C&state=S');
    const res = await handleOAuthCallback(req, env);
    expect(res.headers.get('Location')).toContain('reason=state_missing');
  });

  it('state mismatch → redirect oauth_error reason=state_mismatch', async () => {
    const stateA = await signState({ workspace_id: '00000000-0000-0000-0000-000000000001' }, env.ENCRYPTION_KEY, 600);
    const stateB = await signState({ workspace_id: '00000000-0000-0000-0000-000000000001' }, env.ENCRYPTION_KEY, 600);
    const req = new Request(`https://w.dev/oauth/google-ads/callback?code=C&state=${stateA}`, {
      headers: { Cookie: `lt_oauth_state=${stateB}` },
    });
    const res = await handleOAuthCallback(req, env);
    expect(res.headers.get('Location')).toContain('reason=state_mismatch');
  });

  it('listAccessibleCustomers retorna [] → redirect reason=no_accounts', async () => {
    const state = await signState({ workspace_id: '00000000-0000-0000-0000-000000000001' }, env.ENCRYPTION_KEY, 600);
    vi.spyOn(oauth, 'exchangeCodeForTokens').mockResolvedValue({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    vi.spyOn(client, 'listAccessibleCustomers').mockResolvedValue([]);

    const req = new Request(`https://w.dev/oauth/google-ads/callback?code=C&state=${state}`, {
      headers: { Cookie: `lt_oauth_state=${state}` },
    });
    const res = await handleOAuthCallback(req, env);
    expect(res.headers.get('Location')).toContain('reason=no_accounts');
  });

  it('1 customer → upsert account + redirect status=connected', async () => {
    const WID = '00000000-0000-0000-0000-000000000001';
    const state = await signState({ workspace_id: WID }, env.ENCRYPTION_KEY, 600);
    vi.spyOn(oauth, 'exchangeCodeForTokens').mockResolvedValue({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    vi.spyOn(client, 'listAccessibleCustomers').mockResolvedValue(['1234567890']);

    const sb = createSupabaseClient(env);
    await sb.delete('google_ads_accounts', { workspace_id: `eq.${WID}`, customer_id: 'eq.1234567890' });

    const req = new Request(`https://w.dev/oauth/google-ads/callback?code=C&state=${state}`, {
      headers: { Cookie: `lt_oauth_state=${state}` },
    });
    const res = await handleOAuthCallback(req, env);
    expect(res.headers.get('Location')).toContain('status=connected');

    const accs = await sb.select<{ customer_id: string; account_name: string | null }>('google_ads_accounts', {
      workspace_id: `eq.${WID}`, customer_id: 'eq.1234567890', select: 'customer_id,account_name',
    });
    expect(accs.length).toBe(1);
    expect(accs[0].account_name).toBe('Conta 123-456-7890');
    // cleanup
    await sb.delete('google_ads_accounts', { workspace_id: `eq.${WID}`, customer_id: 'eq.1234567890' });
  });

  it('2+ customers → cria pending session + redirect /select', async () => {
    const WID = '00000000-0000-0000-0000-000000000001';
    const state = await signState({ workspace_id: WID }, env.ENCRYPTION_KEY, 600);
    vi.spyOn(oauth, 'exchangeCodeForTokens').mockResolvedValue({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    vi.spyOn(client, 'listAccessibleCustomers').mockResolvedValue(['1111111111', '2222222222']);

    const sb = createSupabaseClient(env);
    await sb.delete('oauth_pending_selections', { workspace_id: `eq.${WID}` });

    const req = new Request(`https://w.dev/oauth/google-ads/callback?code=C&state=${state}`, {
      headers: { Cookie: `lt_oauth_state=${state}` },
    });
    const res = await handleOAuthCallback(req, env);
    const loc = res.headers.get('Location') ?? '';
    expect(loc).toContain('/dashboard/integrations/select?session=');

    const pending = await sb.select<{ id: string }>('oauth_pending_selections', {
      workspace_id: `eq.${WID}`, select: 'id',
    });
    expect(pending.length).toBeGreaterThanOrEqual(1);
    // cleanup
    await sb.delete('oauth_pending_selections', { workspace_id: `eq.${WID}` });
  });
});

describe('GET /oauth/google-ads/session/:uuid/preview', () => {
  const WID = '00000000-0000-0000-0000-000000000001'; // seed workspace
  const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  let sb: ReturnType<typeof createSupabaseClient>;

  beforeEach(async () => {
    Object.assign(env, { ENCRYPTION_KEY: KEY });
    sb = createSupabaseClient(env);
    await sb.delete('oauth_pending_selections', { workspace_id: `eq.${WID}` });
  });
  afterEach(() => vi.restoreAllMocks());

  async function makeReq(): Promise<Request> {
    return new Request('https://w.dev/oauth/google-ads/session/x/preview', {
      headers: { Authorization: 'Bearer t', 'X-User-JWT': 'jwt' },
    });
  }

  async function insertPending(workspaceId: string, expiresAt?: string): Promise<string> {
    const payloadJson = JSON.stringify({ access_token: 'AT', refresh_token: 'RT', customer_ids: ['1112223333', '4445556666'] });
    const { ciphertext, iv } = await encryptAesGcm(KEY, payloadJson);
    const row: Record<string, unknown> = { workspace_id: workspaceId, encrypted_payload: ciphertext, payload_iv: iv };
    if (expiresAt) {
      // satisfaz CHECK(expires_at > created_at): created_at no passado
      row.created_at = new Date(Date.now() - 3 * 60_000).toISOString();
      row.expires_at = expiresAt;
    }
    await sb.insert('oauth_pending_selections', row);
    const found = await sb.select<{ id: string }>('oauth_pending_selections', {
      workspace_id: `eq.${workspaceId}`, encrypted_payload: `eq.${ciphertext}`, select: 'id', limit: '1', order: 'created_at.desc',
    });
    return found[0].id;
  }

  it('401 quando validateInternalRequest falha', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockRejectedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    const res = await handleOAuthPreview(await makeReq(), env, 'any-uuid');
    expect(res.status).toBe(401);
  });

  it('404 quando session uuid inexistente', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockResolvedValue({ workspaceIds: [WID], userId: 'u' });
    const res = await handleOAuthPreview(await makeReq(), env, '00000000-0000-0000-0000-0000deadbeef');
    expect(res.status).toBe(404);
  });

  it('404 quando session pertence a workspace que o user não tem', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockResolvedValue({ workspaceIds: [], userId: 'u' }); // user sem workspaces
    const sessionId = await insertPending(WID);
    const res = await handleOAuthPreview(await makeReq(), env, sessionId);
    expect(res.status).toBe(404);
  });

  it('410 quando session expirada', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockResolvedValue({ workspaceIds: [WID], userId: 'u' });
    const sessionId = await insertPending(WID, new Date(Date.now() - 60_000).toISOString());
    const res = await handleOAuthPreview(await makeReq(), env, sessionId);
    expect(res.status).toBe(410);
    // confirma que foi deletada
    const remaining = await sb.select<{ id: string }>('oauth_pending_selections', { id: `eq.${sessionId}`, select: 'id' });
    expect(remaining.length).toBe(0);
  });

  it('200 retorna {session_id, customer_ids, expires_at}', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockResolvedValue({ workspaceIds: [WID], userId: 'u' });
    const sessionId = await insertPending(WID);
    const res = await handleOAuthPreview(await makeReq(), env, sessionId);
    expect(res.status).toBe(200);
    const body = await res.json() as { session_id: string; customer_ids: string[]; expires_at: string };
    expect(body.session_id).toBe(sessionId);
    expect(body.customer_ids).toEqual(['1112223333', '4445556666']);
    expect(typeof body.expires_at).toBe('string');
  });

  // cleanup pós-suite — só rows do seed workspace inseridas aqui (efêmeras, beforeEach do próximo run limpa também)
  afterAll(async () => {
    const sbc = createSupabaseClient(env);
    await sbc.delete('oauth_pending_selections', { workspace_id: `eq.${WID}` });
  });
});
