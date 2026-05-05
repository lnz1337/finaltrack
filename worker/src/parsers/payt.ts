import type { ConversionDraft, ConversionType } from '../types';

// IgnoredEventError sinaliza ao route que o evento e conhecido mas nao deve gerar
// uma row em conversions (ex: notificacoes de logistica, chargeback_presented).
// Distinto de plain Error('evento desconhecido') que indica bug — esse bubble pra 500.
// Route handler captura IgnoredEventError e retorna 200 sem insert.
export class IgnoredEventError extends Error {
  constructor(public reason: string) {
    super(`Payt: evento ignorado (${reason})`);
    this.name = 'IgnoredEventError';
  }
}

interface PaytPayload {
  integration_key?: string;
  transaction_id?: string;
  cart_id?: string;
  test?: boolean;
  status?: string;
  type?: string;
  customer?: {
    name?: string;
    email?: string;
    fake_email?: boolean;
    phone?: string;
    // Shape 2020 (documentado no README)
    origin?: {
      query_params?: Record<string, unknown> | unknown[];
    };
    // Shape 2025 (NAO-documentado no README, presente em exemplos novos)
    most_recent_campaign?: {
      last_query_params?: Record<string, unknown> | unknown[];
    };
  };
  product?: { code?: string };
  link?: {
    sources?: Record<string, unknown> | unknown[];
    query_params?: Record<string, unknown> | unknown[];
  };
  transaction?: {
    payment_method?: string;
    payment_status?: string;
    total_price?: number;
    paid_at?: string;
    created_at?: string;
  };
  started_at?: string;
}

// Polymorphic helper: Payt envia link.sources e link.query_params como [] (array
// vazio) quando ausente, e como object {...} quando populado. Trata ambos como
// dicionario lookup-friendly. Inline aqui (regra de 3 — extrair quando aparecer
// terceiro caso fora desse parser).
function safeAsObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// Busca um valor em multiplas paths (4 locais possiveis no payload Payt) tentando
// keys em ordem (canonical primeiro, alias depois — match wins na primeira ocorrencia).
function getQueryParam(p: PaytPayload, ...keys: string[]): string | undefined {
  const paths = [
    safeAsObject(p.customer?.most_recent_campaign?.last_query_params),
    safeAsObject(p.customer?.origin?.query_params),
    safeAsObject(p.link?.query_params),
    safeAsObject(p.link?.sources),
  ];
  for (const key of keys) {
    for (const params of paths) {
      const v = params[key];
      if (typeof v === 'string' && v) return v;
    }
  }
  return undefined;
}

// Conjuntos de payment_status que mapeiam para o mesmo conversion_type.
const REFUND_STATUSES = new Set([
  'refunded',
  'one_click_buy_refunded',
  'refunded_partial',
  'one_click_buy_refunded_partial',
]);

// payment_status que sao notificacoes/falhas — Payt envia mas nao geram conversion.
// peding_refund e typo do README oficial; aceitamos ambas grafias defensivamente.
const IGNORED_PAYMENT_STATUSES = new Set([
  'chargeback_presented',
  'refused',
  'one_click_buy_refused',
  'canceled',
  'cancelled',
  'peding_refund',
  'pending_refund',
]);

// Top-level statuses que sao puramente lifecycle (logistica, state changes) — IGNORE.
const IGNORED_TOP_STATUSES = new Set([
  'billed',
  'separation',
  'collected',
  'shipping',
  'shipped',
  'subscription_canceled',
  'subscription_overdue',
  'canceled',
  'cancelled',
]);

const SUBSCRIPTION_PAID_STATUSES = new Set([
  'subscription_activated',
  'subscription_renewed',
  'subscription_reactivated',
]);

// Mapeia (status, payment_status, payment_method, type) para conversion_type ou IGNORE.
// Ordem de checagem importa: payment_status terminal (refund/chargeback/expired)
// vence sobre top-level status. Notificacoes (chargeback_presented etc.) sao
// IGNORADAS antes de cair no path 'paid'.
function dispatchType(p: PaytPayload): ConversionType {
  const status = (p.status ?? '').toLowerCase();
  const tx = p.transaction ?? {};
  const paymentStatus = (tx.payment_status ?? '').toLowerCase();
  const paymentMethod = (tx.payment_method ?? '').toLowerCase();
  const type = (p.type ?? '').toLowerCase();

  // 1. payment_status terminal events — vencem sobre top-level status
  if (REFUND_STATUSES.has(paymentStatus)) return 'refund';
  if (paymentStatus === 'chargeback') return 'chargeback';
  if (paymentStatus === 'expired') return 'expired';

  // 2. payment_status que devem ser IGNORADOS (notificacoes, falhas)
  if (IGNORED_PAYMENT_STATUSES.has(paymentStatus)) {
    throw new IgnoredEventError(`payment_status=${paymentStatus}`);
  }

  // 3. paid: status=paid OU subscription_activated/_renewed/_reactivated OU payment_status=reprocessed
  if (status === 'paid' || SUBSCRIPTION_PAID_STATUSES.has(status)) return 'paid';
  if (paymentStatus === 'reprocessed') return 'paid';

  // 4. waiting_payment → pix/billet pelo payment_method
  if (status === 'waiting_payment') {
    if (paymentMethod === 'pix') return 'pix_generated';
    if (paymentMethod === 'boleto') return 'billet_generated';
    throw new IgnoredEventError(`waiting_payment com payment_method=${paymentMethod} desconhecido`);
  }

  // 5. lost_cart → abandoned (usa cart_id como external_order_id; tratado em parsePayt)
  if (status === 'lost_cart') return 'abandoned';

  // 6. manual_sell/manual_upsell — vendas reais via admin (revenue real, sem origem)
  if (type === 'manual_sell' || type === 'manual_upsell') return 'paid';

  // 7. Ignorados conhecidos (logistica, subscription state changes)
  if (IGNORED_TOP_STATUSES.has(status)) {
    throw new IgnoredEventError(`status=${status}`);
  }

  // 8. Genuinamente desconhecido — Error padrao (bubble pra 500, sinal de bug)
  throw new Error(`Payt: evento desconhecido: status=${status} payment_status=${paymentStatus}`);
}

export function parsePayt(raw: unknown): ConversionDraft {
  const p = raw as PaytPayload;

  const conversion_type = dispatchType(p);

  // external_order_id: lost_cart usa cart_id (sem transaction_id),
  // resto usa transaction_id (estavel por charge — distinto pra renewal de subscription).
  const external_order_id =
    conversion_type === 'abandoned'
      ? String(p.cart_id ?? '')
      : String(p.transaction_id ?? '');

  // Amount: total_price em centavos → divide por 100. Currency hardcode BRL (Payt e BR-only).
  const amount = (p.transaction?.total_price ?? 0) / 100;
  const currency = 'BRL';

  // PII: fake_email=true significa email fake/auto-gerado — preserve NULL pra nao
  // poluir Enhanced Conversions matching downstream (Fase 3). Phone e nome ficam.
  const customer = p.customer ?? {};
  const customer_email = customer.fake_email
    ? undefined
    : customer.email?.trim().toLowerCase();
  const customer_phone = customer.phone;
  const nameParts = customer.name?.trim().split(/\s+/) ?? [];
  const customer_first_name = nameParts[0] || undefined;
  const customer_last_name = nameParts.slice(1).join(' ') || undefined;

  // Click ID propagation: aceita xcod (canonical Fase 1) ou click_id (alternativa Payt).
  const click_id_from_payload = getQueryParam(p, 'xcod', 'click_id');

  // Aliases iOS LTP: lt_gci/lt_wbr/lt_gbr substituem gclid/wbraid/gbraid quando canonicos
  // faltarem. Canonical sempre ganha (Google Ads tracking template emite ambos so em
  // fallback). Same convention do parser Kiwify.
  const gclid_from_payload = getQueryParam(p, 'gclid', 'lt_gci');
  const wbraid_from_payload = getQueryParam(p, 'wbraid', 'lt_wbr');
  const gbraid_from_payload = getQueryParam(p, 'gbraid', 'lt_gbr');

  // occurred_at: prefere transaction.paid_at, fallback transaction.created_at, fallback started_at, fallback now.
  // Payt usa formato 'Y-m-d H:i:s' (sem timezone) — tratamos como UTC pra estabilidade.
  const occurredRaw =
    p.transaction?.paid_at ?? p.transaction?.created_at ?? p.started_at ?? null;
  const occurred_at = occurredRaw
    ? new Date(occurredRaw.replace(' ', 'T') + 'Z').toISOString()
    : new Date().toISOString();

  return {
    external_order_id,
    conversion_type,
    amount,
    currency,
    customer_email,
    customer_phone,
    customer_first_name,
    customer_last_name,
    click_id_from_payload,
    gclid_from_payload,
    wbraid_from_payload,
    gbraid_from_payload,
    occurred_at,
    offer_external_id: p.product?.code,
    is_test: p.test === true,
    raw,
  };
}
