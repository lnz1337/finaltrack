import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createSupabaseClient } from '../src/lib/supabase';
import * as cryptoLib from '../src/lib/crypto';
import paidCC from './fixtures/payt/paid-credit-card.json';
import testEvent from './fixtures/payt/test-event.json';
import lostCart from './fixtures/payt/lost-cart.json';
import refunded from './fixtures/payt/refunded.json';
import ignoredBilled from './fixtures/payt/ignored-billed.json';
import ltGci2020 from './fixtures/payt/lt-gci-2020.json';
import ltGci2025 from './fixtures/payt/lt-gci-2025.json';

const WS = '00000000-0000-0000-0000-000000000001';
const TOKEN = 'dev_payt_token_cccccccccccccccc';
const sb = createSupabaseClient(env);
const TEST_CLICK_PREFIX = 'test_payt_';
const TEST_ORDER_PREFIX = 'TEST-P-';
const TEST_CART_PREFIX = 'TEST-CART-P-';

async function cleanup() {
  await sb.delete('conversions', { workspace_id: `eq.${WS}`, external_order_id: `like.${TEST_ORDER_PREFIX}%` });
  await sb.delete('conversions', { workspace_id: `eq.${WS}`, external_order_id: `like.${TEST_CART_PREFIX}%` });
  await sb.delete('clicks', { workspace_id: `eq.${WS}`, click_id: `like.${TEST_CLICK_PREFIX}%` });
}

beforeEach(cleanup);
afterAll(cleanup);

async function postPayt(body: string) {
  return SELF.fetch(`http://test/webhook/payt/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

// Constroi body com integration_key=DEV_PAYT_SECRET por default e overrides opcionais.
// Fixtures usam o integration_key do exemplo Payt real (a74cf...) — overridden aqui
// pra bater com a secret de dev armazenada em webhook_secrets resolution path.
function makeBody<T extends Record<string, unknown>>(
  payload: T,
  overrides: Partial<{ transaction_id: string; cart_id: string; integration_key: string }> = {}
): string {
  return JSON.stringify({
    ...payload,
    integration_key: overrides.integration_key ?? env.DEV_PAYT_SECRET!,
    ...(overrides.transaction_id !== undefined ? { transaction_id: overrides.transaction_id } : {}),
    ...(overrides.cart_id !== undefined ? { cart_id: overrides.cart_id } : {}),
  });
}

describe('POST /webhook/payt/:token — auth integration_key', () => {
  it('(a) integration_key correto + paid → 200 + insert + is_test=false', async () => {
    const body = makeBody(paidCC, { transaction_id: `${TEST_ORDER_PREFIX}001` });
    const res = await postPayt(body);
    expect(res.status).toBe(200);
    const rows = await sb.select<{ external_order_id: string; conversion_type: string; is_test: boolean }>(
      'conversions',
      { external_order_id: `eq.${TEST_ORDER_PREFIX}001`, select: 'external_order_id,conversion_type,is_test' }
    );
    expect(rows.length).toBe(1);
    expect(rows[0].conversion_type).toBe('paid');
    expect(rows[0].is_test).toBe(false);
  });

  it('(b) integration_key incorreto → 401 sem insert', async () => {
    const body = makeBody(paidCC, { transaction_id: `${TEST_ORDER_PREFIX}002`, integration_key: 'errado' });
    const res = await postPayt(body);
    expect(res.status).toBe(401);
    const rows = await sb.select<{ external_order_id: string }>(
      'conversions',
      { external_order_id: `eq.${TEST_ORDER_PREFIX}002`, select: 'external_order_id' }
    );
    expect(rows.length).toBe(0);
  });

  it('(c) integration_key incorreto, mesmo length → 401 + spy timingSafeEqualHex chamado', async () => {
    const correct = env.DEV_PAYT_SECRET!;
    const wrong = correct.slice(0, -1) + (correct.slice(-1) === 'X' ? 'Y' : 'X');
    expect(wrong.length).toBe(correct.length);
    const spy = vi.spyOn(cryptoLib, 'timingSafeEqualHex');
    const body = makeBody(paidCC, { transaction_id: `${TEST_ORDER_PREFIX}003`, integration_key: wrong });
    const res = await postPayt(body);
    expect(res.status).toBe(401);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('POST /webhook/payt/:token — is_test propagation', () => {
  it('(d) test=true no payload → 200 + insert com is_test=true', async () => {
    const body = makeBody(testEvent, { transaction_id: `${TEST_ORDER_PREFIX}TEST` });
    const res = await postPayt(body);
    expect(res.status).toBe(200);
    const rows = await sb.select<{ is_test: boolean }>(
      'conversions',
      { external_order_id: `eq.${TEST_ORDER_PREFIX}TEST`, select: 'is_test' }
    );
    expect(rows.length).toBe(1);
    expect(rows[0].is_test).toBe(true);
  });
});

describe('POST /webhook/payt/:token — ignored events', () => {
  it('(e) status=billed (logistics) → 200 SEM insert + console.log com reason', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const body = makeBody(ignoredBilled, { transaction_id: `${TEST_ORDER_PREFIX}BILLED` });
    const res = await postPayt(body);
    expect(res.status).toBe(200);
    const rows = await sb.select<{ external_order_id: string }>(
      'conversions',
      { external_order_id: `eq.${TEST_ORDER_PREFIX}BILLED`, select: 'external_order_id' }
    );
    expect(rows.length).toBe(0);
    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('[webhook-payt] Evento ignorado');
    expect(logged).toContain('billed');
    logSpy.mockRestore();
  });
});

describe('POST /webhook/payt/:token — lost_cart usa cart_id', () => {
  it('(f) lost_cart → external_order_id = cart_id (sem transaction_id)', async () => {
    const cartId = `${TEST_CART_PREFIX}LOST-001`;
    // lost-cart fixture tem cart_id mas sem transaction_id — overridden via makeBody
    const body = makeBody(lostCart, { cart_id: cartId });
    const res = await postPayt(body);
    expect(res.status).toBe(200);
    const rows = await sb.select<{ external_order_id: string; conversion_type: string }>(
      'conversions',
      { external_order_id: `eq.${cartId}`, select: 'external_order_id,conversion_type' }
    );
    expect(rows.length).toBe(1);
    expect(rows[0].conversion_type).toBe('abandoned');
  });
});

describe('POST /webhook/payt/:token — idempotência', () => {
  it('(g) mesmo body 2x → 200 + apenas 1 row em conversions (UNIQUE constraint protege)', async () => {
    const body = makeBody(paidCC, { transaction_id: `${TEST_ORDER_PREFIX}IDEMP` });
    const r1 = await postPayt(body);
    const r2 = await postPayt(body);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const rows = await sb.select<{ external_order_id: string }>(
      'conversions',
      { external_order_id: `eq.${TEST_ORDER_PREFIX}IDEMP`, select: 'external_order_id' }
    );
    expect(rows.length).toBe(1);
  });
});

describe('POST /webhook/payt/:token — janela 55d', () => {
  it('(h) refund de paid antiga (>55d) dispara console.warn TODO(fase-3)', async () => {
    // Insere uma 'paid' original com occurred_at >55d atrás
    const oldDate = new Date(Date.now() - 60 * 86400_000).toISOString();
    const orderId = `${TEST_ORDER_PREFIX}WIN-OLD`;
    await sb.insert('conversions', {
      workspace_id: WS,
      external_order_id: orderId,
      conversion_type: 'paid',
      amount: 97,
      currency: 'BRL',
      match_method: 'unmatched',
      occurred_at: oldDate,
      raw_payload: {},
      is_test: false,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Webhook de refund pra mesma order
    const body = makeBody(refunded, { transaction_id: orderId });
    const res = await postPayt(body);
    expect(res.status).toBe(200);
    const warnedMsg = (warnSpy.mock.calls[0]?.[0] as string) ?? '';
    expect(warnedMsg).toContain('[webhook-payt]');
    expect(warnedMsg).toContain('fora da janela 55d');
    expect(warnedMsg).toContain("TODO(fase-3)");
    warnSpy.mockRestore();
  });
});

describe('POST /webhook/payt/:token — click ID resolution end-to-end', () => {
  it('(i) lt_gci shape 2025 → click vinculado via gclid_in_payload (90d)', async () => {
    // Insere click com gclid recente
    const clickId = `${TEST_CLICK_PREFIX}2025`;
    await sb.insert('clicks', {
      click_id: clickId,
      visitor_id: 'v',
      workspace_id: WS,
      gclid: 'GCLID_FROM_2025_PATH',
      landing_url: 'http://lp',
    });

    const body = makeBody(ltGci2025, { transaction_id: `${TEST_ORDER_PREFIX}MATCH-2025` });
    const res = await postPayt(body);
    expect(res.status).toBe(200);
    const rows = await sb.select<{ click_id: string; match_method: string }>(
      'conversions',
      { external_order_id: `eq.${TEST_ORDER_PREFIX}MATCH-2025`, select: 'click_id,match_method' }
    );
    expect(rows.length).toBe(1);
    expect(rows[0].click_id).toBe(clickId);
    expect(rows[0].match_method).toBe('gclid_in_payload');
  });

  it('(j) lt_gci shape 2020 → click vinculado via gclid_in_payload (90d)', async () => {
    const clickId = `${TEST_CLICK_PREFIX}2020`;
    await sb.insert('clicks', {
      click_id: clickId,
      visitor_id: 'v',
      workspace_id: WS,
      gclid: 'GCLID_FROM_2020_PATH',
      landing_url: 'http://lp',
    });

    const body = makeBody(ltGci2020, { transaction_id: `${TEST_ORDER_PREFIX}MATCH-2020` });
    const res = await postPayt(body);
    expect(res.status).toBe(200);
    const rows = await sb.select<{ click_id: string; match_method: string }>(
      'conversions',
      { external_order_id: `eq.${TEST_ORDER_PREFIX}MATCH-2020`, select: 'click_id,match_method' }
    );
    expect(rows.length).toBe(1);
    expect(rows[0].click_id).toBe(clickId);
    expect(rows[0].match_method).toBe('gclid_in_payload');
  });
});
