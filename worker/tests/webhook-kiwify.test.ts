import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createSupabaseClient } from '../src/lib/supabase';
import { hmacSha256Hex } from '../src/lib/crypto';
import approved from './fixtures/kiwify-order-approved.json';

const WS = '00000000-0000-0000-0000-000000000001';
const TOKEN = 'dev_kiwify_token_aaaaaaaaaaaaaaaa';
const sb = createSupabaseClient(env);
const TEST_CLICK_PREFIX = 'test_kiwify_';
const TEST_ORDER_PREFIX = 'TEST-K-';

async function cleanup() {
  await sb.delete('conversions', { workspace_id: `eq.${WS}`, external_order_id: `like.${TEST_ORDER_PREFIX}%` });
  await sb.delete('clicks', { workspace_id: `eq.${WS}`, click_id: `like.${TEST_CLICK_PREFIX}%` });
}

beforeEach(cleanup);
afterAll(cleanup);

async function postWebhook(body: string, signature: string) {
  return SELF.fetch(`http://test/webhook/kiwify/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kiwify-signature': signature },
    body,
  });
}

describe('POST /webhook/kiwify/:token', () => {
  it('rejeita 401 com HMAC inválido', async () => {
    const body = JSON.stringify({ ...approved, order_id: 'TEST-K-001' });
    const res = await postWebhook(body, 'deadbeef');
    expect(res.status).toBe(401);
  });

  it('cria conversion com match_method=click_id quando click existe', async () => {
    await sb.insert('clicks', { click_id: 'test_kiwify_xyz', visitor_id: 'v', workspace_id: WS, landing_url: 'http://lp', gclid: 'GCLID_AAA' });
    const payload = {
      ...approved,
      order_id: 'TEST-K-001',
      TrackingParameters: { ...approved.TrackingParameters, xcod: 'test_kiwify_xyz' },
    };
    const body = JSON.stringify(payload);
    const sig = await hmacSha256Hex(env.DEV_KIWIFY_SECRET!, body);
    const res = await postWebhook(body, sig);
    expect(res.status).toBe(200);

    const rows = await sb.select<any>('conversions', {
      workspace_id: `eq.${WS}`,
      external_order_id: 'eq.TEST-K-001',
      select: 'click_id,match_method,amount,currency,conversion_type',
    });
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      click_id: 'test_kiwify_xyz',
      match_method: 'click_id',
      conversion_type: 'paid',
    });
  });

  it('cria conversion com match_method=gclid_in_payload quando só gclid bate', async () => {
    await sb.insert('clicks', { click_id: 'test_kiwify_other', visitor_id: 'v', workspace_id: WS, landing_url: 'http://lp', gclid: 'GCLID_AAA' });
    const payload = {
      ...approved,
      order_id: 'TEST-K-002',
      TrackingParameters: { gclid: 'GCLID_AAA' }, // sem xcod
    };
    const body = JSON.stringify(payload);
    const sig = await hmacSha256Hex(env.DEV_KIWIFY_SECRET!, body);
    const res = await postWebhook(body, sig);
    expect(res.status).toBe(200);

    const rows = await sb.select<any>('conversions', { external_order_id: 'eq.TEST-K-002', select: 'match_method,click_id' });
    expect(rows[0].match_method).toBe('gclid_in_payload');
    expect(rows[0].click_id).toBe('test_kiwify_other');
  });

  it('é idempotente em (workspace, order, type) — mesmo payload 2x não duplica', async () => {
    const payload = { ...approved, order_id: 'TEST-K-003' };
    const body = JSON.stringify(payload);
    const sig = await hmacSha256Hex(env.DEV_KIWIFY_SECRET!, body);
    const r1 = await postWebhook(body, sig);
    const r2 = await postWebhook(body, sig);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const rows = await sb.select<any>('conversions', { external_order_id: 'eq.TEST-K-003', select: 'id' });
    expect(rows.length).toBe(1);
  });

  it('responde 404 com endpoint_token inválido', async () => {
    const body = JSON.stringify({ ...approved, order_id: 'TEST-K-404' });
    const res = await SELF.fetch('http://test/webhook/kiwify/token_inexistente', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kiwify-signature': 'x' },
      body,
    });
    expect(res.status).toBe(404);
  });
});
