import type { Env } from '../types';
import { createSupabaseClient } from '../lib/supabase';
import { sha256Hex, hashEmail, hashPhone } from '../lib/crypto';
import { createDedup } from '../lib/dedup';
import { resolveWebhookSecret } from '../lib/webhook-secret';
import { matchConversion } from '../lib/matching';
import { parseHotmart } from '../parsers/hotmart';

export async function handleWebhookHotmart(req: Request, env: Env, endpointToken: string): Promise<Response> {
  const resolved = await resolveWebhookSecret(env, 'hotmart', endpointToken);
  if (!resolved) return new Response('not found', { status: 404 });

  const hottok = req.headers.get('x-hotmart-hottok') ?? '';
  if (hottok !== resolved.secret_plaintext) return new Response('invalid signature', { status: 401 });

  const rawBody = await req.text();

  const dedup = createDedup({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  const dedupKey = `wh:hotmart:${await sha256Hex(resolved.workspace_id + rawBody)}`;
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

  let offer_id: string | null = null;
  if (draft.offer_external_id) {
    const offers = await sb.select<{ id: string }>('offers', {
      workspace_id: `eq.${resolved.workspace_id}`,
      external_product_id: `eq.${draft.offer_external_id}`,
      checkout_platform: 'eq.hotmart',
      select: 'id',
      limit: '1',
    });
    offer_id = offers[0]?.id ?? null;
  }

  const row = {
    workspace_id: resolved.workspace_id,
    click_id: match.click_id,
    offer_id,
    external_order_id: draft.external_order_id,
    conversion_type: draft.conversion_type,
    amount: draft.amount,
    currency: draft.currency,
    customer_email_hash: draft.customer_email ? await hashEmail(draft.customer_email) : null,
    customer_phone_hash: draft.customer_phone ? await hashPhone(draft.customer_phone) : null,
    customer_first_name_hash: draft.customer_first_name ? await sha256Hex(draft.customer_first_name.trim().toLowerCase()) : null,
    customer_last_name_hash: draft.customer_last_name ? await sha256Hex(draft.customer_last_name.trim().toLowerCase()) : null,
    match_method: match.match_method,
    raw_payload: draft.raw,
    occurred_at: draft.occurred_at,
  };

  await sb.insert('conversions', row, { onConflict: 'workspace_id,external_order_id,conversion_type' });
  return new Response(null, { status: 200 });
}
