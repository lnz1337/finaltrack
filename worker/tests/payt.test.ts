import { describe, it, expect } from 'vitest';
import { parsePayt, IgnoredEventError } from '../src/parsers/payt';

import paidCC from './fixtures/payt/paid-credit-card.json';
import paidPix from './fixtures/payt/paid-pix.json';
import pixGen from './fixtures/payt/pix-generated.json';
import billetGen from './fixtures/payt/billet-generated.json';
import refunded from './fixtures/payt/refunded.json';
import chargeback from './fixtures/payt/chargeback.json';
import expired from './fixtures/payt/expired.json';
import lostCart from './fixtures/payt/lost-cart.json';
import subRenewed from './fixtures/payt/subscription-renewed.json';
import testEvent from './fixtures/payt/test-event.json';
import ltGci2020 from './fixtures/payt/lt-gci-2020.json';
import ltGci2025 from './fixtures/payt/lt-gci-2025.json';
import utmFallback from './fixtures/payt/utm-fallback.json';
import linkSourcesEmpty from './fixtures/payt/link-sources-empty-array.json';
import fakeEmail from './fixtures/payt/fake-email.json';
import manualSell from './fixtures/payt/manual-sell.json';
import ignoredBilled from './fixtures/payt/ignored-billed.json';
import ignoredCbPresented from './fixtures/payt/ignored-chargeback-presented.json';

describe('parsePayt - event mapping', () => {
  it('paid credit_card → conversion_type=paid, amount em reais (cents/100)', () => {
    const d = parsePayt(paidCC);
    expect(d.conversion_type).toBe('paid');
    expect(d.amount).toBe(97); // 9700 cents → 97
    expect(d.currency).toBe('BRL');
    expect(d.external_order_id).toBe('TX-PAID-CC-001');
  });

  it('paid pix → conversion_type=paid', () => {
    const d = parsePayt(paidPix);
    expect(d.conversion_type).toBe('paid');
    expect(d.amount).toBe(49);
  });

  it('waiting_payment + payment_method=pix → pix_generated', () => {
    expect(parsePayt(pixGen).conversion_type).toBe('pix_generated');
  });

  it('waiting_payment + payment_method=boleto → billet_generated', () => {
    expect(parsePayt(billetGen).conversion_type).toBe('billet_generated');
  });

  it('payment_status=refunded → refund', () => {
    expect(parsePayt(refunded).conversion_type).toBe('refund');
  });

  it('payment_status=chargeback → chargeback', () => {
    expect(parsePayt(chargeback).conversion_type).toBe('chargeback');
  });

  it('payment_status=expired → expired', () => {
    expect(parsePayt(expired).conversion_type).toBe('expired');
  });

  it('lost_cart → abandoned + external_order_id usa cart_id (sem transaction_id)', () => {
    const d = parsePayt(lostCart);
    expect(d.conversion_type).toBe('abandoned');
    expect(d.external_order_id).toBe('CART-LOST-001');
  });

  it('subscription_renewed → paid (cobrança recorrente)', () => {
    expect(parsePayt(subRenewed).conversion_type).toBe('paid');
  });
});

describe('parsePayt - is_test propagation', () => {
  it('test=true no payload → is_test=true em ConversionDraft', () => {
    expect(parsePayt(testEvent).is_test).toBe(true);
  });

  it('test=false no payload → is_test=false em ConversionDraft', () => {
    expect(parsePayt(paidCC).is_test).toBe(false);
  });
});

describe('parsePayt - click ID resolution', () => {
  it('shape 2020: customer.origin.query_params.lt_gci → gclid_from_payload', () => {
    const d = parsePayt(ltGci2020);
    expect(d.gclid_from_payload).toBe('GCLID_FROM_2020_PATH');
  });

  it('shape 2025: customer.most_recent_campaign.last_query_params.lt_gci → gclid_from_payload', () => {
    const d = parsePayt(ltGci2025);
    expect(d.gclid_from_payload).toBe('GCLID_FROM_2025_PATH');
  });

  it('só utm_* (sem lt_gci nem gclid em nenhum lugar) → gclid_from_payload undefined', () => {
    const d = parsePayt(utmFallback);
    expect(d.gclid_from_payload).toBeUndefined();
    expect(d.click_id_from_payload).toBeUndefined();
  });
});

describe('parsePayt - polymorphic shapes', () => {
  it('link.sources=[] (array vazio) NÃO crasha + retorna draft válido', () => {
    expect(() => parsePayt(linkSourcesEmpty)).not.toThrow();
    const d = parsePayt(linkSourcesEmpty);
    expect(d.conversion_type).toBe('paid');
  });
});

describe('parsePayt - PII handling', () => {
  it('fake_email=true → customer_email=undefined (NÃO hashear email fake)', () => {
    const d = parsePayt(fakeEmail);
    expect(d.customer_email).toBeUndefined();
    // Phone ainda passa (fake_email afeta só email)
    expect(d.customer_phone).toBe('+5511999990000');
  });

  it('fake_email=false → customer_email normalizado lowercase', () => {
    const d = parsePayt(paidCC);
    expect(d.customer_email).toBe('joao@example.com');
  });
});

describe('parsePayt - manual sales', () => {
  it('type=manual_sell → conversion_type=paid (revenue real, sem origem de tráfego)', () => {
    const d = parsePayt(manualSell);
    expect(d.conversion_type).toBe('paid');
    // Sem click_id ou gclid → match será unmatched no route, mas parser não decide isso
    expect(d.click_id_from_payload).toBeUndefined();
    expect(d.gclid_from_payload).toBeUndefined();
    expect(d.amount).toBe(97);
  });
});

describe('parsePayt - ignored events', () => {
  it('status=billed (logística pós-paid) → throw IgnoredEventError', () => {
    expect(() => parsePayt(ignoredBilled)).toThrow(IgnoredEventError);
    try {
      parsePayt(ignoredBilled);
    } catch (e) {
      expect(e).toBeInstanceOf(IgnoredEventError);
      expect((e as Error).message).toContain('billed');
    }
  });

  it('payment_status=chargeback_presented (notificação de disputa) → throw IgnoredEventError', () => {
    expect(() => parsePayt(ignoredCbPresented)).toThrow(IgnoredEventError);
    try {
      parsePayt(ignoredCbPresented);
    } catch (e) {
      expect(e).toBeInstanceOf(IgnoredEventError);
      expect((e as Error).message).toContain('chargeback_presented');
    }
  });
});
