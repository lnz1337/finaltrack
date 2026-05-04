import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../src/lib/supabase';
import { matchConversion } from '../src/lib/matching';

const WS = '00000000-0000-0000-0000-000000000001';
const sb = createSupabaseClient(env);
const TEST_CLICK_PREFIX = 'test_match_';

async function seedClick(opts: { click_id: string; gclid?: string; clicked_at?: string }) {
  await sb.insert('clicks', {
    click_id: opts.click_id,
    visitor_id: 'vmatch',
    workspace_id: WS,
    landing_url: 'http://test/lp',
    gclid: opts.gclid,
    clicked_at: opts.clicked_at,
  });
}

async function cleanup() {
  await sb.delete('clicks', { workspace_id: `eq.${WS}`, click_id: `like.${TEST_CLICK_PREFIX}%` });
}

beforeEach(cleanup);
afterAll(cleanup);

describe('matchConversion', () => {
  it('match_method=click_id quando click_id_from_payload existe', async () => {
    await seedClick({ click_id: 'test_match_a', gclid: 'GA1' });
    const r = await matchConversion(sb, WS, { click_id_from_payload: 'test_match_a', gclid_from_payload: 'GA1' });
    expect(r).toEqual({ click_id: 'test_match_a', match_method: 'click_id' });
  });

  it('match_method=gclid_in_payload quando só gclid bate', async () => {
    await seedClick({ click_id: 'test_match_b', gclid: 'GB1' });
    const r = await matchConversion(sb, WS, { gclid_from_payload: 'GB1' });
    expect(r).toEqual({ click_id: 'test_match_b', match_method: 'gclid_in_payload' });
  });

  it('match_method=unmatched quando nada bate', async () => {
    const r = await matchConversion(sb, WS, { gclid_from_payload: 'NUNCA_VISTO' });
    expect(r).toEqual({ click_id: null, match_method: 'unmatched' });
  });

  it('gclid fora da janela de 90 dias não bate', async () => {
    const old = new Date(Date.now() - 100 * 86400_000).toISOString();
    await seedClick({ click_id: 'test_match_c', gclid: 'GC1', clicked_at: old });
    const r = await matchConversion(sb, WS, { gclid_from_payload: 'GC1' });
    expect(r.match_method).toBe('unmatched');
  });

  it('click_id no payload tem prioridade mesmo se inválido (não cai pra gclid)', async () => {
    await seedClick({ click_id: 'test_match_d', gclid: 'GD1' });
    const r = await matchConversion(sb, WS, { click_id_from_payload: 'naoexiste', gclid_from_payload: 'GD1' });
    // click_id_from_payload existe no payload mas não bate em clicks → cai pro fallback
    expect(r.match_method).toBe('gclid_in_payload');
    expect(r.click_id).toBe('test_match_d');
  });
});
