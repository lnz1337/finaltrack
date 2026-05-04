import type { Env } from '../types';
import { createSupabaseClient } from '../lib/supabase';
import { verifyHmacSha256, hashEmail, hashPhone, sha256Hex } from '../lib/crypto';
import { createDedup } from '../lib/dedup';
import { resolveWebhookSecret } from '../lib/webhook-secret';
import { matchConversion } from '../lib/matching';
import { parseKiwify } from '../parsers/kiwify';

export async function handleWebhookKiwify(req: Request, env: Env, endpointToken: string): Promise<Response> {
  const resolved = await resolveWebhookSecret(env, 'kiwify', endpointToken);
  if (!resolved) return new Response('not found', { status: 404 });

  const rawBody = await req.text();
  const sig = req.headers.get('x-kiwify-signature') ?? '';
  if (!sig) return new Response('missing signature', { status: 401 });
  const ok = await verifyHmacSha256(resolved.secret_plaintext, rawBody, sig);
  if (!ok) return new Response('invalid signature', { status: 401 });

  // dedup
  const dedup = createDedup({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  const dedupKey = `wh:kiwify:${await sha256Hex(resolved.workspace_id + rawBody)}`;
  const isDup = await dedup.checkAndMark(dedupKey, 86400);
  if (isDup) return new Response(null, { status: 200 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const draft = parseKiwify(payload);
  const sb = createSupabaseClient(env);
  const match = await matchConversion(sb, resolved.workspace_id, {
    click_id_from_payload: draft.click_id_from_payload,
    gclid_from_payload: draft.gclid_from_payload,
  });

  // resolver offer_id pelo external_product_id
  let offer_id: string | null = null;
  if (draft.offer_external_id) {
    const offers = await sb.select<{ id: string }>('offers', {
      workspace_id: `eq.${resolved.workspace_id}`,
      external_product_id: `eq.${draft.offer_external_id}`,
      checkout_platform: 'eq.kiwify',
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
