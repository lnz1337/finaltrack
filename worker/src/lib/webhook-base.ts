import { sha256Hex, hashEmail, hashPhone } from './crypto';
import type { SupabaseClient } from './supabase';
import type { ConversionDraft, MatchMethod } from '../types';

// Helpers compartilhados entre webhook routes (Kiwify, Hotmart, futuramente Payt).
// Mantém auth/body-read/parser específicos no caller — só extraímos lógica idêntica
// entre plataformas.

// Dedup key estável: hash de (workspace_id + raw body) namespaced por plataforma.
// Mesma plataforma + mesmo workspace + mesmo body → mesma key (Upstash bloqueia retry duplicado).
export async function buildDedupKey(platform: string, workspaceId: string, rawBody: string): Promise<string> {
  return `wh:${platform}:${await sha256Hex(workspaceId + rawBody)}`;
}

// Lookup do offer_id a partir do external_product_id do payload.
// Retorna null se externalProductId não veio no payload OU não bate com nenhum offer cadastrado.
export async function resolveOfferId(
  sb: SupabaseClient,
  workspaceId: string,
  externalProductId: string | undefined,
  checkoutPlatform: string,
): Promise<string | null> {
  if (!externalProductId) return null;
  const offers = await sb.select<{ id: string }>('offers', {
    workspace_id: `eq.${workspaceId}`,
    external_product_id: `eq.${externalProductId}`,
    checkout_platform: `eq.${checkoutPlatform}`,
    select: 'id',
    limit: '1',
  });
  return offers[0]?.id ?? null;
}

export interface MatchOutcome {
  click_id: string | null;
  match_method: MatchMethod;
}

// Monta o row pra inserir em `conversions`. Hashea PII (email/phone/name) em SHA-256.
// Email/phone normalizados via helpers (hashEmail = lowercase+trim; hashPhone = só dígitos).
// Names normalizados inline (lowercase+trim) pra estabilidade vs whitespace/case do payload.
export async function buildConversionRow(
  workspaceId: string,
  draft: ConversionDraft,
  match: MatchOutcome,
  offerId: string | null,
): Promise<Record<string, unknown>> {
  return {
    workspace_id: workspaceId,
    click_id: match.click_id,
    offer_id: offerId,
    external_order_id: draft.external_order_id,
    conversion_type: draft.conversion_type,
    amount: draft.amount,
    currency: draft.currency,
    customer_email_hash: draft.customer_email ? await hashEmail(draft.customer_email) : null,
    customer_phone_hash: draft.customer_phone ? await hashPhone(draft.customer_phone) : null,
    customer_first_name_hash: draft.customer_first_name
      ? await sha256Hex(draft.customer_first_name.trim().toLowerCase())
      : null,
    customer_last_name_hash: draft.customer_last_name
      ? await sha256Hex(draft.customer_last_name.trim().toLowerCase())
      : null,
    match_method: match.match_method,
    raw_payload: draft.raw,
    occurred_at: draft.occurred_at,
    is_test: draft.is_test ?? false,
  };
}
