import type { Env } from '../types';
import { createSupabaseClient } from '../lib/supabase';
import { createDedup } from '../lib/dedup';
import { resolveWebhookSecret } from '../lib/webhook-secret';
import { matchConversion } from '../lib/matching';
import { findOriginalConversion } from '../lib/conversions';
import { checkAdjustmentWindow } from '../lib/conversion-window';
import { buildDedupKey, resolveOfferId, buildConversionRow } from '../lib/webhook-base';
import { parseHotmart } from '../parsers/hotmart';

export async function handleWebhookHotmart(req: Request, env: Env, endpointToken: string): Promise<Response> {
  const resolved = await resolveWebhookSecret(env, 'hotmart', endpointToken);
  if (!resolved) return new Response('not found', { status: 404 });

  const hottok = req.headers.get('x-hotmart-hottok') ?? '';
  if (hottok !== resolved.secret_plaintext) return new Response('invalid signature', { status: 401 });

  const rawBody = await req.text();

  const dedup = createDedup({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  const dedupKey = await buildDedupKey('hotmart', resolved.workspace_id, rawBody);
  if (await dedup.checkAndMark(dedupKey, 86400)) return new Response(null, { status: 200 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const draft = parseHotmart(payload);
  const sb = createSupabaseClient(env);
  const match = await matchConversion(sb, resolved.workspace_id, {
    click_id_from_payload: draft.click_id_from_payload,
    gclid_from_payload: draft.gclid_from_payload,
  });

  const offer_id = await resolveOfferId(sb, resolved.workspace_id, draft.offer_external_id, 'hotmart');
  const row = await buildConversionRow(resolved.workspace_id, draft, match, offer_id);

  await sb.insert('conversions', row, { onConflict: 'workspace_id,external_order_id,conversion_type' });

  // Scaffold Fase 3: refund/chargeback fora da janela 55d → warn (sem bloquear o webhook).
  if (draft.conversion_type === 'refund' || draft.conversion_type === 'chargeback') {
    const original = await findOriginalConversion(sb, resolved.workspace_id, draft.external_order_id);
    checkAdjustmentWindow({
      platform: 'hotmart',
      conversionType: draft.conversion_type,
      originalConversion: original,
      externalOrderId: draft.external_order_id,
      workspaceId: resolved.workspace_id,
    });
  }

  return new Response(null, { status: 200 });
}
