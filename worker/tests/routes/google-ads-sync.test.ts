import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { handleGoogleAdsSync } from '../../src/routes/google-ads-sync';
import * as internalAuth from '../../src/lib/internal-auth';
import * as syncMod from '../../src/lib/google-ads/sync';
import { createSupabaseClient } from '../../src/lib/supabase';

const WID = '00000000-0000-0000-0000-000000000001'; // seed workspace
const ACCOUNT_ID = crypto.randomUUID();
const CUSTOMER_ID = String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999));

// ExecutionContext stub — só precisa de waitUntil() existindo (não usado na impl síncrona)
const ctxStub = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function makeReq(body: unknown): Request {
  return new Request('https://w.dev/api/google-ads/sync', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'X-User-JWT': 'jwt', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/google-ads/sync', () => {
  let sb: ReturnType<typeof createSupabaseClient>;

  beforeEach(async () => {
    sb = createSupabaseClient(env);
    await sb.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
    await sb.insert('google_ads_accounts', {
      id: ACCOUNT_ID, workspace_id: WID, customer_id: CUSTOMER_ID,
      refresh_token_encrypted: 'ct', refresh_token_iv: 'iv', is_active: true,
    });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    const sbc = createSupabaseClient(env);
    await sbc.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
  });

  it('401 quando validateInternalRequest falha', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockRejectedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    const res = await handleGoogleAdsSync(makeReq({ google_ads_account_id: ACCOUNT_ID }), env, ctxStub);
    expect(res.status).toBe(401);
  });

  it('404 quando account não pertence ao user', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockResolvedValue({ workspaceIds: ['00000000-0000-0000-0000-0000ffffffff'], userId: 'u' });
    const res = await handleGoogleAdsSync(makeReq({ google_ads_account_id: ACCOUNT_ID }), env, ctxStub);
    expect(res.status).toBe(404);
  });

  it('200 com {log_id, status, started_at} em sucesso', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockResolvedValue({ workspaceIds: [WID], userId: 'u' });
    vi.spyOn(syncMod, 'syncAccount').mockResolvedValue({ log_id: 'log-123', status: 'success', rows_synced: 5, duration_ms: 1200 });
    const res = await handleGoogleAdsSync(makeReq({ google_ads_account_id: ACCOUNT_ID }), env, ctxStub);
    expect(res.status).toBe(200);
    const body = await res.json() as { log_id: string; status: string; started_at: string };
    expect(body.log_id).toBe('log-123');
    expect(body.status).toBe('success');
    expect(typeof body.started_at).toBe('string');
  });

  it('409 quando syncAccount lança sync_in_progress', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockResolvedValue({ workspaceIds: [WID], userId: 'u' });
    vi.spyOn(syncMod, 'syncAccount').mockRejectedValue(new Error('sync_in_progress'));
    const res = await handleGoogleAdsSync(makeReq({ google_ads_account_id: ACCOUNT_ID }), env, ctxStub);
    expect(res.status).toBe(409);
  });
});
