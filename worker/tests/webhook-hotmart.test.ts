import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createSupabaseClient } from '../src/lib/supabase';
import approved from './fixtures/hotmart-purchase-approved.json';

const WS = '00000000-0000-0000-0000-000000000001';
const TOKEN = 'dev_hotmart_token_bbbbbbbbbbbbbbbb';
const sb = createSupabaseClient(env);
const TEST_CLICK_PREFIX = 'test_hotmart_';
const TEST_ORDER_PREFIX = 'TEST-H-';

async function cleanup() {
  await sb.delete('conversions', { workspace_id: `eq.${WS}`, external_order_id: `like.${TEST_ORDER_PREFIX}%` });
  await sb.delete('clicks', { workspace_id: `eq.${WS}`, click_id: `like.${TEST_CLICK_PREFIX}%` });
}

beforeEach(cleanup);
afterAll(cleanup);

async function postWebhook(body: string, hottok: string) {
  return SELF.fetch(`http://test/webhook/hotmart/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hotmart-hottok': hottok },
    body,
  });
}

/** Build a hotmart payload overriding transaction and optionally external_code */
function makePayload(transaction: string, externalCode?: string) {
  return {
    ...approved,
    data: {
      ...approved.data,
      purchase: {
        ...approved.data.purchase,
        transaction,
        tracking: {
          ...approved.data.purchase.tracking,
          ...(externalCode !== undefined ? { external_code: externalCode } : {}),
        },
      },
    },
  };
}

describe('POST /webhook/hotmart/:token', () => {
  it('rejeita 401 com Hottok inválido', async () => {
    const res = await postWebhook(JSON.stringify(makePayload('TEST-H-001')), 'errado');
    expect(res.status).toBe(401);
  });

  it('cria conversion com match_method=click_id', async () => {
    await sb.insert('clicks', { click_id: 'test_hotmart_001', visitor_id: 'v', workspace_id: WS, landing_url: 'http://lp' });
    const payload = makePayload('TEST-H-001', 'test_hotmart_001');
    const res = await postWebhook(JSON.stringify(payload), env.DEV_HOTMART_SECRET!);
    expect(res.status).toBe(200);
    const rows = await sb.select<any>('conversions', {
      external_order_id: 'eq.TEST-H-001',
      select: 'click_id,match_method,conversion_type',
    });
    expect(rows[0]).toMatchObject({
      click_id: 'test_hotmart_001',
      match_method: 'click_id',
      conversion_type: 'paid',
    });
  });

  it('idempotente em duplicata', async () => {
    const payload = makePayload('TEST-H-002');
    const r1 = await postWebhook(JSON.stringify(payload), env.DEV_HOTMART_SECRET!);
    const r2 = await postWebhook(JSON.stringify(payload), env.DEV_HOTMART_SECRET!);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const rows = await sb.select<any>('conversions', { external_order_id: 'eq.TEST-H-002', select: 'id' });
    expect(rows.length).toBe(1);
  });
});
