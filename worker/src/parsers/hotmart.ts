import type { ConversionDraft, ConversionType } from '../types';

interface HotmartPayload {
  id?: string;
  event?: string;
  creation_date?: number;
  data?: {
    purchase?: {
      transaction?: string;
      approved_date?: number;
      status?: string;
      price?: { value?: number; currency_value?: string };
      tracking?: {
        external_code?: string;
        source?: string;
        src?: string;
        sck?: string;
        lt_gci?: string;
        lt_wbr?: string;
        lt_gbr?: string;
        [k: string]: unknown;
      };
    };
    buyer?: { email?: string; name?: string; checkout_phone?: string };
    product?: { id?: string | number; name?: string };
  };
}

const EVENT_TO_TYPE: Record<string, ConversionType> = {
  PURCHASE_APPROVED: 'paid',
  PURCHASE_REFUNDED: 'refund',
  PURCHASE_CHARGEBACK: 'chargeback',
  PURCHASE_BILLET_PRINTED: 'billet_generated',
  PURCHASE_OUT_OF_SHOPPING_CART: 'abandoned',
};

export function parseHotmart(raw: unknown): ConversionDraft {
  const p = raw as HotmartPayload;
  const evt = p.event ?? '';
  const conversion_type = EVENT_TO_TYPE[evt];
  if (!conversion_type) throw new Error(`Hotmart: evento desconhecido: ${evt}`);

  const purchase = p.data?.purchase;
  const buyer = p.data?.buyer;
  const product = p.data?.product;
  const tracking = purchase?.tracking ?? {};

  const occurredMs = purchase?.approved_date ?? p.creation_date ?? Date.now();
  const occurred_at = new Date(occurredMs).toISOString();

  // Hotmart usa external_code como o "xcod" da gente
  const click_id_from_payload = tracking.external_code;

  // Hotmart NÃO repassa gclid/wbraid/gbraid nativamente. Aliases iOS LTP
  // (lt_gci/lt_wbr/lt_gbr) são a única fonte aceita em payload Hotmart —
  // o lojista os propaga via tracking template do Google Ads. Se Fase 2/3
  // mostrar necessidade de canônico, reabrir com decisão explícita.
  const gclid_from_payload = tracking.lt_gci as string | undefined;
  const wbraid_from_payload = tracking.lt_wbr as string | undefined;
  const gbraid_from_payload = tracking.lt_gbr as string | undefined;

  const email = buyer?.email?.trim().toLowerCase();

  return {
    external_order_id: String(purchase?.transaction ?? ''),
    conversion_type,
    amount: purchase?.price?.value ?? 0,
    currency: purchase?.price?.currency_value ?? 'BRL',
    customer_email: email,
    customer_phone: buyer?.checkout_phone,
    customer_first_name: buyer?.name?.split(/\s+/)[0],
    customer_last_name: buyer?.name?.split(/\s+/).slice(1).join(' ') || undefined,
    click_id_from_payload,
    gclid_from_payload,
    wbraid_from_payload,
    gbraid_from_payload,
    occurred_at,
    offer_external_id: product?.id !== undefined ? String(product.id) : undefined,
    // Hotmart nao expoe flag de teste no payload — producao sempre.
    is_test: false,
    raw,
  };
}
