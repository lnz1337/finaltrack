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
