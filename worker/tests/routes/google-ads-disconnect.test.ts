import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { handleGoogleAdsDisconnect } from '../../src/routes/google-ads-disconnect';
import * as internalAuth from '../../src/lib/internal-auth';
import { createSupabaseClient } from '../../src/lib/supabase';

const WID = '00000000-0000-0000-0000-000000000001'; // seed workspace
const ACCOUNT_ID = crypto.randomUUID();
const CUSTOMER_ID = String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999));

function makeReq(body: unknown): Request {
  return new Request('https://w.dev/api/google-ads/disconnect', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'X-User-JWT': 'jwt', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/google-ads/disconnect', () => {
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
    const res = await handleGoogleAdsDisconnect(makeReq({ google_ads_account_id: ACCOUNT_ID }), env);
    expect(res.status).toBe(401);
  });

  it('404 quando account não pertence ao user', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockResolvedValue({ workspaceIds: ['00000000-0000-0000-0000-0000ffffffff'], userId: 'u' });
    const res = await handleGoogleAdsDisconnect(makeReq({ google_ads_account_id: ACCOUNT_ID }), env);
    expect(res.status).toBe(404);
  });

  it('200 marca is_active=false', async () => {
    vi.spyOn(internalAuth, 'validateInternalRequest').mockResolvedValue({ workspaceIds: [WID], userId: 'u' });
    const res = await handleGoogleAdsDisconnect(makeReq({ google_ads_account_id: ACCOUNT_ID }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as { is_active: boolean };
    expect(body.is_active).toBe(false);

    const row = await sb.select<{ is_active: boolean }>('google_ads_accounts', { id: `eq.${ACCOUNT_ID}`, select: 'is_active' });
    expect(row[0].is_active).toBe(false);
  });
});
