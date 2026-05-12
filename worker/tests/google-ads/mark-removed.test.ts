import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../../src/lib/supabase';

// UUIDs/customer_id randomizados por execução de teste — NUNCA hardcoded.
// Hardcoded colide com dados de dev/seed (UUIDs `...a001` etc.) e o cleanup
// abaixo cascateia campaigns/ad_groups/ads de dados reais. Lição P12.
const ACCOUNT_ID = crypto.randomUUID();
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'; // dev workspace do seed (este existe sempre — não deletar)
const CUSTOMER_ID = String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999));

interface SbExtended {
  rpc: <T = unknown>(name: string, params: Record<string, unknown>) => Promise<T>;
}

async function resetFixtures(sb: ReturnType<typeof createSupabaseClient>) {
  // limpa estado de testes anteriores (cascade via FK)
  await sb.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
  await sb.insert('google_ads_accounts', {
    id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    customer_id: CUSTOMER_ID,
    refresh_token_encrypted: 'fake_ct',
    refresh_token_iv: 'fake_iv',
  });
}

async function insertCampaign(sb: ReturnType<typeof createSupabaseClient>, id: string, lastSyncedAt: string, status = 'ENABLED') {
  const gcid = id.replace(/-/g, '').slice(-12); // 12 hex chars — suficientemente único por account
  await sb.insert('campaigns', {
    id,
    google_ads_account_id: ACCOUNT_ID,
    google_campaign_id: gcid,
    name: `c-${gcid}`,
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

  // Cleanup pós-suite (último teste não tem beforeEach seguinte). Cascade limpa campaigns/ad_groups/ads.
  // Deleta APENAS o ACCOUNT_ID random deste run — zero colisão com dados reais.
  afterAll(async () => {
    const sbCleanup = createSupabaseClient(env);
    await sbCleanup.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
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
    await insertCampaign(sb, crypto.randomUUID(), oldSync);
    await insertCampaign(sb, crypto.randomUUID(), oldSync);

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
    await insertCampaign(sb, crypto.randomUUID(), oldSync, 'REMOVED');

    const startedAt = new Date(Date.now() - 1000).toISOString();
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(0);
  });

  it('cenário d: p_started_at no futuro marca tudo', async () => {
    await insertCampaign(sb, crypto.randomUUID(), new Date().toISOString());
    const startedAt = new Date(Date.now() + 60000).toISOString(); // 1 min no futuro
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(1);
  });

  it('cenário e: p_started_at antigo demais não marca nada', async () => {
    await insertCampaign(sb, crypto.randomUUID(), new Date().toISOString());
    const startedAt = new Date(Date.now() - 60000).toISOString(); // 1 min atrás
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(0);
  });
});
