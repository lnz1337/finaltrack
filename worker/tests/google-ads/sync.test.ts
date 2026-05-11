import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { syncAccount } from '../../src/lib/google-ads/sync';
import * as client from '../../src/lib/google-ads/client';
import { createSupabaseClient } from '../../src/lib/supabase';
import { encryptAesGcm } from '../../src/lib/crypto';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = '00000000-0000-0000-0000-00000000a100';
const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const CUSTOMER_ID = '2222222222';

async function setupAccount(sb: ReturnType<typeof createSupabaseClient>) {
  await sb.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
  const { ciphertext, iv } = await encryptAesGcm(KEY_HEX, 'fake-refresh-token');
  await sb.insert('google_ads_accounts', {
    id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    customer_id: CUSTOMER_ID,
    refresh_token_encrypted: ciphertext,
    refresh_token_iv: iv,
    is_active: true,
  });
}

describe('syncAccount orchestrator', () => {
  let sb: ReturnType<typeof createSupabaseClient>;

  beforeEach(async () => {
    sb = createSupabaseClient(env);
    Object.assign(env, { ENCRYPTION_KEY: KEY_HEX });
    await setupAccount(sb);
    await sb.delete('google_ads_sync_log', { google_ads_account_id: `eq.${ACCOUNT_ID}` });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: sync completo cria sync_log status=success', async () => {
    vi.spyOn(client, 'refreshAccessToken').mockResolvedValue({ access_token: 'AT', expires_in: 3600 });
    vi.spyOn(client, 'googleAdsSearch')
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C1', status: 'ENABLED' } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await syncAccount(env, sb, ACCOUNT_ID, 'manual');
    expect(result.status).toBe('success');

    const logs = await sb.select<{ status: string; sync_type: string }>('google_ads_sync_log', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`, select: 'status,sync_type',
    });
    expect(logs[0].sync_type).toBe('metadata');
    expect(logs[0].status).toBe('success');
  });

  it('zombie cleanup: log anterior em running > 5min vira failed', async () => {
    const sixMinAgo = new Date(Date.now() - 6 * 60_000).toISOString();
    await sb.insert('google_ads_sync_log', {
      google_ads_account_id: ACCOUNT_ID,
      sync_type: 'metadata',
      status: 'running',
      started_at: sixMinAgo,
      date_range_start: '2026-05-07',
      date_range_end: '2026-05-07',
    });

    vi.spyOn(client, 'refreshAccessToken').mockResolvedValue({ access_token: 'AT', expires_in: 3600 });
    vi.spyOn(client, 'googleAdsSearch').mockResolvedValue([]);

    await syncAccount(env, sb, ACCOUNT_ID, 'manual');

    const zombieRows = await sb.select<{ status: string; error_message: string | null }>('google_ads_sync_log', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      started_at: `eq.${sixMinAgo}`,
      select: 'status,error_message',
    });
    expect(zombieRows[0].status).toBe('failed');
    expect(zombieRows[0].error_message).toBe('zombie_timeout');
  });

  it('409 sync_in_progress: log running < 5min bloqueia novo sync', async () => {
    await sb.insert('google_ads_sync_log', {
      google_ads_account_id: ACCOUNT_ID,
      sync_type: 'metadata',
      status: 'running',
      started_at: new Date().toISOString(),
      date_range_start: '2026-05-07',
      date_range_end: '2026-05-07',
    });

    await expect(syncAccount(env, sb, ACCOUNT_ID, 'manual')).rejects.toThrow(/sync_in_progress/);
  });

  it('invalid_grant marca account is_active=false', async () => {
    const { InvalidGrantError } = await import('../../src/lib/google-ads/errors');
    vi.spyOn(client, 'refreshAccessToken').mockRejectedValue(new InvalidGrantError());

    await expect(syncAccount(env, sb, ACCOUNT_ID, 'manual')).rejects.toBeInstanceOf(InvalidGrantError);

    const acc = await sb.select<{ is_active: boolean }>('google_ads_accounts', {
      id: `eq.${ACCOUNT_ID}`, select: 'is_active',
    });
    expect(acc[0].is_active).toBe(false);
  });

  it('REMOVED detection: campaign não retornada no sync vira REMOVED', async () => {
    await sb.delete('campaigns', { google_ads_account_id: `eq.${ACCOUNT_ID}` });
    const oldSync = new Date(Date.now() - 60_000).toISOString();
    await sb.insert('campaigns', {
      google_ads_account_id: ACCOUNT_ID,
      google_campaign_id: '999',
      name: 'old',
      status: 'ENABLED',
      last_synced_at: oldSync,
    });

    vi.spyOn(client, 'refreshAccessToken').mockResolvedValue({ access_token: 'AT', expires_in: 3600 });
    vi.spyOn(client, 'googleAdsSearch').mockResolvedValue([]);

    await syncAccount(env, sb, ACCOUNT_ID, 'manual');

    const c = await sb.select<{ status: string }>('campaigns', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      google_campaign_id: 'eq.999',
      select: 'status',
    });
    expect(c[0].status).toBe('REMOVED');
  });
});
