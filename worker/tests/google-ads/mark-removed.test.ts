import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../../src/lib/supabase';

const ACCOUNT_ID = '00000000-0000-0000-0000-00000000a001';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'; // dev workspace do seed

interface SbExtended {
  rpc: <T = unknown>(name: string, params: Record<string, unknown>) => Promise<T>;
}

async function resetFixtures(sb: ReturnType<typeof createSupabaseClient>) {
  // limpa estado de testes anteriores (cascade via FK)
  await sb.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
  await sb.insert('google_ads_accounts', {
    id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    customer_id: '1234567890',
    refresh_token_encrypted: 'fake_ct',
    refresh_token_iv: 'fake_iv',
  });
}

async function insertCampaign(sb: ReturnType<typeof createSupabaseClient>, id: string, lastSyncedAt: string, status = 'ENABLED') {
  await sb.insert('campaigns', {
    id,
    google_ads_account_id: ACCOUNT_ID,
    google_campaign_id: id.slice(-3),
    name: `c-${id.slice(-3)}`,
    status,
    last_synced_at: lastSyncedAt,
  });
}

describe('mark_removed_for_account RPC', () => {
  let sb: ReturnType<typeof createSupabaseClient> & SbExtended;

  beforeEach(async () => {
    sb = createSupabaseClient(env) as typeof sb;
    await resetFixtures(sb);
  });

  it('cenário a: zero mudanças retorna (0, 0, 0)', async () => {
    const startedAt = new Date(Date.now() - 1000).toISOString();
    const result = await sb.rpc<Array<{ campaigns_marked: number; ad_groups_marked: number; ads_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0]).toEqual({ campaigns_marked: 0, ad_groups_marked: 0, ads_marked: 0 });
  });

  it('cenário b: campaigns com last_synced_at antigo são marcadas REMOVED', async () => {
    const oldSync = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h margin
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c001', oldSync);
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c002', oldSync);

    const startedAt = new Date(Date.now() - 1000).toISOString();
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(2);

    const rows = await sb.select<{ status: string }>('campaigns', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      select: 'status',
    });
    expect(rows.every((r) => r.status === 'REMOVED')).toBe(true);
  });

  it('cenário c: campaigns já em REMOVED não são re-tocadas (idempotência)', async () => {
    const oldSync = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h margin
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c003', oldSync, 'REMOVED');

    const startedAt = new Date(Date.now() - 1000).toISOString();
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(0);
  });

  it('cenário d: p_started_at no futuro marca tudo', async () => {
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c004', new Date().toISOString());
    const startedAt = new Date(Date.now() + 60000).toISOString(); // 1 min no futuro
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(1);
  });

  it('cenário e: p_started_at antigo demais não marca nada', async () => {
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c005', new Date().toISOString());
    const startedAt = new Date(Date.now() - 60000).toISOString(); // 1 min atrás
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(0);
  });
});
