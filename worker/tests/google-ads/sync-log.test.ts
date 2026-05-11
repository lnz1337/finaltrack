import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../../src/lib/supabase';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = '00000000-0000-0000-0000-00000000a002';

describe('google_ads_sync_log', () => {
  let sb: ReturnType<typeof createSupabaseClient>;

  beforeEach(async () => {
    sb = createSupabaseClient(env);
    await sb.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
    await sb.insert('google_ads_accounts', {
      id: ACCOUNT_ID,
      workspace_id: WORKSPACE_ID,
      customer_id: '1111111111',
      refresh_token_encrypted: 'x',
      refresh_token_iv: 'y',
    });
  });

  // Cleanup pós-suite: o último teste não tem beforeEach seguinte que limpe.
  // Sem isso, rows em google_ads_sync_log (via cascade do account) sobram e
  // poluem /api/google-ads/sync-status em dev local. Mesmo padrão de tc_cors/match_d (phase-1-status §gotchas).
  afterAll(async () => {
    const sbCleanup = createSupabaseClient(env);
    await sbCleanup.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
  });

  it('aceita sync_type=metadata + trace_id + parsed_skipped', async () => {
    const traceId = crypto.randomUUID();
    await sb.insert('google_ads_sync_log', {
      google_ads_account_id: ACCOUNT_ID,
      sync_type: 'metadata',
      status: 'running',
      trace_id: traceId,
      parsed_skipped: 0,
      date_range_start: '2026-05-07',
      date_range_end: '2026-05-07',
    });
    const rows = await sb.select<{ sync_type: string; trace_id: string }>('google_ads_sync_log', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      select: 'sync_type,trace_id',
    });
    expect(rows[0].sync_type).toBe('metadata');
    expect(rows[0].trace_id).toBe(traceId);
  });

  it('aceita status=partial + partial_skipped JSONB roundtrip', async () => {
    const skipped = { reason: 'time_budget_exceeded', elapsed_ms: 28500, phase_completed: 'campaigns', skipped: ['ad_groups', 'ads', 'mark_removed'] };
    await sb.insert('google_ads_sync_log', {
      google_ads_account_id: ACCOUNT_ID,
      sync_type: 'metadata',
      status: 'partial',
      partial_skipped: skipped,
      date_range_start: '2026-05-07',
      date_range_end: '2026-05-07',
    });
    const rows = await sb.select<{ partial_skipped: typeof skipped }>('google_ads_sync_log', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      status: 'eq.partial',
      select: 'partial_skipped',
    });
    expect(rows[0].partial_skipped).toEqual(skipped);
  });

  it('rejeita status fora do CHECK constraint', async () => {
    await expect(
      sb.insert('google_ads_sync_log', {
        google_ads_account_id: ACCOUNT_ID,
        sync_type: 'metadata',
        status: 'banana',
        date_range_start: '2026-05-07',
        date_range_end: '2026-05-07',
      })
    ).rejects.toThrow(/check/i);
  });

  it('rejeita sync_type fora do CHECK constraint', async () => {
    await expect(
      sb.insert('google_ads_sync_log', {
        google_ads_account_id: ACCOUNT_ID,
        sync_type: 'frontend',
        status: 'running',
        date_range_start: '2026-05-07',
        date_range_end: '2026-05-07',
      })
    ).rejects.toThrow(/check/i);
  });
});
