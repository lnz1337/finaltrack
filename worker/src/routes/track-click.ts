import type { Env, ClickRecord } from '../types';
import { createSupabaseClient } from '../lib/supabase';
import { isBot, parseUserAgent } from '../lib/ua';
import { extractGeo } from '../lib/geo';
import { parseUtmPipe } from '../lib/utm';

interface ClickPayload {
  workspace_id?: string;
  click_id?: string;
  visitor_id?: string;
  landing_url?: string;
  referrer?: string | null;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  gclsrc?: string;
  gad_source?: string;
  gad_campaignid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

function isOriginAllowed(env: Env, origin: string | null): boolean {
  if (!origin) return false;
  const allowlist = env.ALLOWED_TRACKING_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  return allowlist.includes(origin);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleTrackClickOptions(req: Request, env: Env): Response {
  const origin = req.headers.get('origin');
  if (!isOriginAllowed(env, origin)) return new Response('forbidden', { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin!) });
}

export async function handleTrackClick(req: Request, env: Env): Promise<Response> {
  const ua = req.headers.get('user-agent') ?? '';

  const origin = req.headers.get('origin');
  const extraHeaders: Record<string, string> = isOriginAllowed(env, origin) && origin
    ? { 'Access-Control-Allow-Origin': origin }
    : {};

  // Bot filter — antes de qualquer parse/IO
  if (isBot(ua)) {
    return new Response(null, { status: 204, headers: extraHeaders });
  }

  // Aceita application/json (fetch) e text/plain (sendBeacon sem preflight).
  // Usamos req.text() + JSON.parse() explicitamente para garantir parse
  // independente do Content-Type declarado pelo browser.
  let body: ClickPayload;
  try {
    const text = await req.text();
    body = JSON.parse(text) as ClickPayload;
  } catch {
    return new Response('invalid json', { status: 400, headers: extraHeaders });
  }

  if (!body.workspace_id || !body.click_id || !body.visitor_id || !body.landing_url) {
    return new Response('missing required fields', { status: 400, headers: extraHeaders });
  }

  const geo = extractGeo(req);
  const uaParsed = parseUserAgent(ua);
  const campaignParsed = parseUtmPipe(body.utm_campaign);
  const adsetParsed = parseUtmPipe(body.utm_content);
  const adParsed = parseUtmPipe(body.utm_term);

  const record: ClickRecord = {
    click_id: body.click_id,
    visitor_id: body.visitor_id,
    workspace_id: body.workspace_id,
    gclid: body.gclid,
    wbraid: body.wbraid,
    gbraid: body.gbraid,
    gclsrc: body.gclsrc,
    gad_source: body.gad_source,
    gad_campaignid: body.gad_campaignid,
    utm_source: body.utm_source,
    utm_medium: body.utm_medium,
    utm_campaign: body.utm_campaign,
    utm_content: body.utm_content,
    utm_term: body.utm_term,
    campaign_name_parsed: campaignParsed?.name,
    campaign_id_parsed: campaignParsed?.id,
    adset_name_parsed: adsetParsed?.name,
    adset_id_parsed: adsetParsed?.id,
    ad_name_parsed: adParsed?.name,
    ad_id_parsed: adParsed?.id,
    landing_url: body.landing_url,
    referrer: body.referrer ?? undefined,
    user_agent: ua,
    ip: geo.ip,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    device_type: uaParsed.device_type,
    os: uaParsed.os,
    browser: uaParsed.browser,
  };

  const sb = createSupabaseClient(env);
  await sb.insert('clicks', record, { onConflict: 'click_id' });

  return new Response(null, { status: 204, headers: extraHeaders });
}
