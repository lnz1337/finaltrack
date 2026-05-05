import type { ConversionDraft, ConversionType } from '../types';

interface KiwifyPayload {
  webhook_event_type?: string;
  order_id?: string;
  order_status?: string;
  created_at?: string;
  Customer?: { email?: string; mobile?: string; first_name?: string; last_name?: string };
  Product?: { product_id?: string };
  Commissions?: { charge_amount?: string | number; currency_type?: string };
  TrackingParameters?: {
    xcod?: string;
    click_id?: string;
    gclid?: string;
    wbraid?: string;
    gbraid?: string;
    lt_gci?: string;
    lt_wbr?: string;
    lt_gbr?: string;
    [k: string]: unknown;
  };
}

const EVENT_TO_TYPE: Record<string, ConversionType> = {
  order_approved: 'paid',
  order_refunded: 'refund',
  pix_created: 'pix_generated',
  billet_created: 'billet_generated',
  abandoned_cart: 'abandoned',
  order_chargeback: 'chargeback',
};

export function parseKiwify(raw: unknown): ConversionDraft {
  const p = raw as KiwifyPayload;
  const evt = (p.webhook_event_type ?? '').toLowerCase();
  const conversion_type = EVENT_TO_TYPE[evt];
  if (!conversion_type) throw new Error(`Kiwify: evento desconhecido: ${evt}`);

  const amountStr = p.Commissions?.charge_amount ?? '0';
  const amount = typeof amountStr === 'number' ? amountStr : parseFloat(amountStr);

  const tp = p.TrackingParameters ?? {};
  const click_id_from_payload = (tp.xcod ?? tp.click_id) as string | undefined;
  // iOS LTP aliases: lt_gci/lt_wbr/lt_gbr substituem gclid/wbraid/gbraid quando canônicos faltarem.
  // Canonical sempre ganha (Google Ads tracking template emite ambos só em fallback).
  const gclid_from_payload = (tp.gclid ?? tp.lt_gci) as string | undefined;
  const wbraid_from_payload = (tp.wbraid ?? tp.lt_wbr) as string | undefined;
  const gbraid_from_payload = (tp.gbraid ?? tp.lt_gbr) as string | undefined;

  const email = p.Customer?.email?.trim().toLowerCase();

  return {
    external_order_id: String(p.order_id ?? ''),
    conversion_type,
    amount,
    currency: p.Commissions?.currency_type ?? 'BRL',
    customer_email: email,
    customer_phone: p.Customer?.mobile,
    customer_first_name: p.Customer?.first_name,
    customer_last_name: p.Customer?.last_name,
    click_id_from_payload,
    gclid_from_payload,
    wbraid_from_payload,
    gbraid_from_payload,
    occurred_at: p.created_at ?? new Date().toISOString(),
    offer_external_id: p.Product?.product_id,
    // Kiwify nao expoe flag de teste no payload — producao sempre.
    is_test: false,
    raw,
  };
}
