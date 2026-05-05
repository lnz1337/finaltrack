import { describe, it, expect } from 'vitest';
import { parseHotmart } from '../src/parsers/hotmart';
import approved from './fixtures/hotmart-purchase-approved.json';
import refunded from './fixtures/hotmart-purchase-refunded.json';
import billet from './fixtures/hotmart-billet.json';

describe('parseHotmart', () => {
  it('PURCHASE_APPROVED → paid', () => {
    const d = parseHotmart(approved);
    expect(d.conversion_type).toBe('paid');
    expect(d.external_order_id).toBe('HP-AAA-001');
    expect(d.amount).toBe(97);
    expect(d.currency).toBe('BRL');
    expect(d.click_id_from_payload).toBe('click_hot_001');
    expect(d.customer_email).toBe('cliente@hot.com');
    expect(d.offer_external_id).toBe('hotmart-product-1');
  });

  it('PURCHASE_REFUNDED → refund', () => {
    expect(parseHotmart(refunded).conversion_type).toBe('refund');
  });

  it('PURCHASE_BILLET_PRINTED → billet_generated', () => {
    expect(parseHotmart(billet).conversion_type).toBe('billet_generated');
  });
});

// Hotmart (a) gclid canônico não é suportado por design — ver parsers/hotmart.ts.
// Hotmart NÃO emite gclid/wbraid/gbraid nativamente; aceitamos só os aliases LTP
// (lt_gci/lt_wbr/lt_gbr) que o lojista propaga via tracking template do Google Ads.
describe('parseHotmart - aliases iOS LTP (lt_gci/lt_wbr/lt_gbr)', () => {
  function payload(tracking: Record<string, unknown>) {
    return {
      ...approved,
      data: {
        ...approved.data,
        purchase: {
          ...approved.data.purchase,
          tracking,
        },
      },
    };
  }

  it('só lt_gci → gclid_from_payload populado', () => {
    const d = parseHotmart(payload({ external_code: 'click_x', lt_gci: 'ALIAS_G' }));
    expect(d.gclid_from_payload).toBe('ALIAS_G');
  });

  it('só lt_wbr → wbraid_from_payload populado', () => {
    const d = parseHotmart(payload({ external_code: 'click_x', lt_wbr: 'ALIAS_W' }));
    expect(d.wbraid_from_payload).toBe('ALIAS_W');
  });

  it('só lt_gbr → gbraid_from_payload populado', () => {
    const d = parseHotmart(payload({ external_code: 'click_x', lt_gbr: 'ALIAS_B' }));
    expect(d.gbraid_from_payload).toBe('ALIAS_B');
  });

  it('sem nenhum gclid/wbraid/gbraid nem alias → fields ficam undefined', () => {
    const d = parseHotmart(payload({ external_code: 'click_x', source: 'google' }));
    expect(d.gclid_from_payload).toBeUndefined();
    expect(d.wbraid_from_payload).toBeUndefined();
    expect(d.gbraid_from_payload).toBeUndefined();
  });

  it('canonical gclid presente → IGNORADO (Hotmart by-design não lê canônico)', () => {
    const d = parseHotmart(payload({ external_code: 'click_x', gclid: 'CANON_G' }));
    expect(d.gclid_from_payload).toBeUndefined();
  });
});
