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
