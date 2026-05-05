import type { Env } from '../types';
import { createSupabaseClient } from '../lib/supabase';
import { timingSafeEqualHex } from '../lib/crypto';
import { createDedup } from '../lib/dedup';
import { resolveWebhookSecret } from '../lib/webhook-secret';
import { matchConversion } from '../lib/matching';
import { findOriginalConversion } from '../lib/conversions';
import { checkAdjustmentWindow } from '../lib/conversion-window';
import { buildDedupKey, resolveOfferId, buildConversionRow } from '../lib/webhook-base';
import { parsePayt, IgnoredEventError } from '../parsers/payt';

export async function handleWebhookPayt(req: Request, env: Env, endpointToken: string): Promise<Response> {
  const resolved = await resolveWebhookSecret(env, 'payt', endpointToken);
  if (!resolved) return new Response('not found', { status: 404 });

  // Payt diverge de Kiwify (HMAC sobre body) e Hotmart (Hottok header).
  // Auth e via integration_key DENTRO do JSON body — precisa parsear ANTES do auth check.
  const rawBody = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const integrationKey = (payload as { integration_key?: unknown })?.integration_key;
  if (typeof integrationKey !== 'string' ||
      !timingSafeEqualHex(integrationKey, resolved.secret_plaintext)) {
    return new Response('invalid signature', { status: 401 });
  }

  // Dedup somente apos auth OK — evita encher Upstash com keys de payloads invalidos.
  const dedup = createDedup({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  const dedupKey = await buildDedupKey('payt', resolved.workspace_id, rawBody);
  if (await dedup.checkAndMark(dedupKey, 86400)) return new Response(null, { status: 200 });

  // Parse → ConversionDraft. IgnoredEventError = evento conhecido mas sem conversion
  // (logistica, notificacoes); plain Error bubble pra 500 (sinal de bug).
  let draft;
  try {
    draft = parsePayt(payload);
  } catch (e) {
    if (e instanceof IgnoredEventError) {
      console.log(`[webhook-payt] Evento ignorado: ${e.reason}`);
      return new Response(null, { status: 200 });
    }
    throw e;
  }

  const sb = createSupabaseClient(env);
  const match = await matchConversion(sb, resolved.workspace_id, {
    click_id_from_payload: draft.click_id_from_payload,
    gclid_from_payload: draft.gclid_from_payload,
  });

  const offer_id = await resolveOfferId(sb, resolved.workspace_id, draft.offer_external_id, 'payt');
  const row = await buildConversionRow(resolved.workspace_id, draft, match, offer_id);

  await sb.insert('conversions', row, { onConflict: 'workspace_id,external_order_id,conversion_type' });

  // Scaffold Fase 3: refund/chargeback fora da janela 55d → warn (sem bloquear o webhook).
  // 'expired' deliberadamente NAO dispara — vencimento passivo de boleto/pix nao e
  // adjustment de uma paid previa, nao gera upload skip downstream.
  if (draft.conversion_type === 'refund' || draft.conversion_type === 'chargeback') {
    const original = await findOriginalConversion(sb, resolved.workspace_id, draft.external_order_id);
    checkAdjustmentWindow({
      platform: 'payt',
      conversionType: draft.conversion_type,
      originalConversion: original,
      externalOrderId: draft.external_order_id,
      workspaceId: resolved.workspace_id,
    });
  }

  return new Response(null, { status: 200 });
}
