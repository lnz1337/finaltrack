import { describe, it, expect } from 'vitest';
import { parseKiwify } from '../src/parsers/kiwify';
import approved from './fixtures/kiwify-order-approved.json';
import pix from './fixtures/kiwify-pix-created.json';
import refund from './fixtures/kiwify-refund.json';

describe('parseKiwify', () => {
  it('order_approved → conversion_type=paid', () => {
    const d = parseKiwify(approved);
    expect(d.conversion_type).toBe('paid');
    expect(d.external_order_id).toBe('ORD-AAA-001');
    expect(d.amount).toBe(97);
    expect(d.currency).toBe('BRL');
    expect(d.click_id_from_payload).toBe('click_xyz_789');
    expect(d.gclid_from_payload).toBe('GCLID_AAA');
    expect(d.customer_email).toBe('maria@exemplo.com'); // normalizado lowercase
    expect(d.offer_external_id).toBe('kiwify-product-1');
  });

  it('pix_created → conversion_type=pix_generated', () => {
    expect(parseKiwify(pix).conversion_type).toBe('pix_generated');
  });

  it('order_refunded → conversion_type=refund', () => {
    expect(parseKiwify(refund).conversion_type).toBe('refund');
  });

  it('preserva raw payload', () => {
    expect(parseKiwify(approved).raw).toEqual(approved);
  });
});

describe('parseKiwify - aliases iOS LTP (lt_gci/lt_wbr/lt_gbr)', () => {
  function payload(tracking: Record<string, unknown>) {
    return {
      ...approved,
      TrackingParameters: tracking,
    };
  }

  it('(a) só gclid → resolve em gclid_from_payload', () => {
    const d = parseKiwify(payload({ gclid: 'CANON_G' }));
    expect(d.gclid_from_payload).toBe('CANON_G');
  });

  it('(b) só lt_gci → resolve em gclid_from_payload', () => {
    const d = parseKiwify(payload({ lt_gci: 'ALIAS_G' }));
    expect(d.gclid_from_payload).toBe('ALIAS_G');
  });

  it('(c) gclid + lt_gci → canonical (gclid) ganha', () => {
    const d = parseKiwify(payload({ gclid: 'CANON_G', lt_gci: 'ALIAS_G' }));
    expect(d.gclid_from_payload).toBe('CANON_G');
  });

  it('(d) nenhum dos 4 aliases nem canonical → ConversionDraft sem gclid/wbraid/gbraid', () => {
    const d = parseKiwify(payload({ utm_source: 'fb' }));
    expect(d.gclid_from_payload).toBeUndefined();
    expect(d.wbraid_from_payload).toBeUndefined();
    expect(d.gbraid_from_payload).toBeUndefined();
  });

  it('(e) só lt_wbr → resolve em wbraid_from_payload', () => {
    const d = parseKiwify(payload({ lt_wbr: 'ALIAS_W' }));
    expect(d.wbraid_from_payload).toBe('ALIAS_W');
  });

  it('(f) só lt_gbr → resolve em gbraid_from_payload', () => {
    const d = parseKiwify(payload({ lt_gbr: 'ALIAS_B' }));
    expect(d.gbraid_from_payload).toBe('ALIAS_B');
  });

  it('canonical wbraid + lt_wbr → canonical ganha', () => {
    const d = parseKiwify(payload({ wbraid: 'CANON_W', lt_wbr: 'ALIAS_W' }));
    expect(d.wbraid_from_payload).toBe('CANON_W');
  });

  it('canonical gbraid + lt_gbr → canonical ganha', () => {
    const d = parseKiwify(payload({ gbraid: 'CANON_B', lt_gbr: 'ALIAS_B' }));
    expect(d.gbraid_from_payload).toBe('CANON_B');
  });
});
