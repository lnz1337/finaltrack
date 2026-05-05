import { describe, it, expect } from 'vitest';
import { buildDedupKey, resolveOfferId, buildConversionRow } from '../src/lib/webhook-base';
import { sha256Hex, hashEmail, hashPhone } from '../src/lib/crypto';
import type { SupabaseClient } from '../src/lib/supabase';
import type { ConversionDraft } from '../src/types';

function stubClient(opts: {
  selectRows?: unknown[];
  onSelect?: (table: string, query: Record<string, string>) => void;
}): SupabaseClient {
  return {
    select: async <T>(table: string, query: Record<string, string>) => {
      opts.onSelect?.(table, query);
      return (opts.selectRows ?? []) as T[];
    },
    insert: async () => undefined,
    delete: async () => undefined,
  };
}

describe('buildDedupKey', () => {
  it('formato wh:<platform>:<sha256(workspace+body)>', async () => {
    const key = await buildDedupKey('kiwify', 'ws-1', '{"order":"x"}');
    const expectedHash = await sha256Hex('ws-1{"order":"x"}');
    expect(key).toBe(`wh:kiwify:${expectedHash}`);
  });

  it('determinístico: mesmos inputs → mesma key', async () => {
    const a = await buildDedupKey('hotmart', 'ws-9', 'body-payload');
    const b = await buildDedupKey('hotmart', 'ws-9', 'body-payload');
    expect(a).toBe(b);
  });

  it('plataformas diferentes → keys diferentes (mesmo workspace+body)', async () => {
    const k = await buildDedupKey('kiwify', 'ws-1', 'same');
    const h = await buildDedupKey('hotmart', 'ws-1', 'same');
    expect(k).not.toBe(h);
  });
});

describe('resolveOfferId', () => {
  it('externalProductId undefined → retorna null sem query', async () => {
    let queried = false;
    const sb = stubClient({ onSelect: () => { queried = true; } });
    const r = await resolveOfferId(sb, 'ws-1', undefined, 'kiwify');
    expect(r).toBeNull();
    expect(queried).toBe(false);
  });

  it('match encontrado → retorna offer.id', async () => {
    const sb = stubClient({ selectRows: [{ id: 'offer-uuid-1' }] });
    const r = await resolveOfferId(sb, 'ws-1', 'prod-x', 'hotmart');
    expect(r).toBe('offer-uuid-1');
  });

  it('match vazio → retorna null', async () => {
    const sb = stubClient({ selectRows: [] });
    const r = await resolveOfferId(sb, 'ws-1', 'prod-x', 'kiwify');
    expect(r).toBeNull();
  });

  it('query usa filtros corretos (workspace + external_product + checkout_platform)', async () => {
    let captured: Record<string, string> = {};
    const sb = stubClient({
      selectRows: [{ id: 'oid' }],
      onSelect: (_table, q) => { captured = q; },
    });
    await resolveOfferId(sb, 'WS-9', 'PROD-9', 'kiwify');
    expect(captured.workspace_id).toBe('eq.WS-9');
    expect(captured.external_product_id).toBe('eq.PROD-9');
    expect(captured.checkout_platform).toBe('eq.kiwify');
    expect(captured.limit).toBe('1');
  });
});

describe('buildConversionRow', () => {
  function draft(overrides: Partial<ConversionDraft> = {}): ConversionDraft {
    return {
      external_order_id: 'ORD-1',
      conversion_type: 'paid',
      amount: 97,
      currency: 'BRL',
      occurred_at: '2026-05-04T12:00:00Z',
      raw: { foo: 'bar' },
      ...overrides,
    };
  }

  const matchClick = { click_id: 'click-123', match_method: 'click_id' as const };
  const matchUnmatched = { click_id: null, match_method: 'unmatched' as const };

  it('row completo com PII → hashes presentes; campos básicos intactos', async () => {
    const row = await buildConversionRow('ws-1', draft({
      customer_email: 'Maria@EXEMPLO.com',
      customer_phone: '+55 11 99999-1111',
      customer_first_name: ' Maria ',
      customer_last_name: 'Silva',
    }), matchClick, 'offer-1');

    expect(row.workspace_id).toBe('ws-1');
    expect(row.click_id).toBe('click-123');
    expect(row.offer_id).toBe('offer-1');
    expect(row.external_order_id).toBe('ORD-1');
    expect(row.conversion_type).toBe('paid');
    expect(row.amount).toBe(97);
    expect(row.currency).toBe('BRL');
    expect(row.match_method).toBe('click_id');
    expect(row.raw_payload).toEqual({ foo: 'bar' });
    expect(row.occurred_at).toBe('2026-05-04T12:00:00Z');
    // Hashes existem e têm formato hex 64 (SHA-256)
    expect(row.customer_email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.customer_phone_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.customer_first_name_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.customer_last_name_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PII hash sanity: email é normalizado (lowercase+trim) antes de hashear', async () => {
    const r1 = await buildConversionRow('ws-1', draft({ customer_email: 'Maria@EXEMPLO.com' }), matchClick, null);
    const r2 = await buildConversionRow('ws-1', draft({ customer_email: '  maria@exemplo.com  ' }), matchClick, null);
    expect(r1.customer_email_hash).toBe(r2.customer_email_hash);
    // Bate com hashEmail direto
    expect(r1.customer_email_hash).toBe(await hashEmail('maria@exemplo.com'));
  });

  it('PII hash sanity: phone é normalizado (só dígitos) antes de hashear', async () => {
    const r = await buildConversionRow('ws-1', draft({ customer_phone: '+55 (11) 99999-1111' }), matchClick, null);
    expect(r.customer_phone_hash).toBe(await hashPhone('+55 (11) 99999-1111'));
    expect(r.customer_phone_hash).toBe(await sha256Hex('5511999991111'));
  });

  it('PII hash sanity: nomes são normalizados (trim+lowercase) antes de hashear', async () => {
    const r = await buildConversionRow('ws-1', draft({ customer_first_name: ' MARIA ' }), matchClick, null);
    expect(r.customer_first_name_hash).toBe(await sha256Hex('maria'));
  });

  it('sem PII e match unmatched → todos os hashes null, click_id null', async () => {
    const row = await buildConversionRow('ws-1', draft(), matchUnmatched, null);
    expect(row.customer_email_hash).toBeNull();
    expect(row.customer_phone_hash).toBeNull();
    expect(row.customer_first_name_hash).toBeNull();
    expect(row.customer_last_name_hash).toBeNull();
    expect(row.click_id).toBeNull();
    expect(row.offer_id).toBeNull();
    expect(row.match_method).toBe('unmatched');
  });
});
