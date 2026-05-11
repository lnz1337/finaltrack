// Parsers defensivos: row inválido (missing required field, wrong type) → null.
// Row válido → objeto pronto pra upsert no schema. Caller incrementa parsed_skipped
// quando recebe null e loga warn com row preview.

interface CampaignParsed {
  google_campaign_id: string;
  name: string;
  campaign_type: string | null;
  status: string;
  bidding_strategy: string | null;
  daily_budget_micros: number | null;
  start_date: string | null;
  end_date: string | null;
}

interface AdGroupParsed {
  campaign_id: string;
  google_ad_group_id: string;
  name: string;
  status: string;
  type: string | null;
  cpc_bid_micros: number | null;
  entity_type: 'AD_GROUP' | 'ASSET_GROUP';
  metadata: Record<string, unknown> | null;
}

interface AdParsed {
  ad_group_id: string;
  google_ad_id: string;
  name: string | null;
  ad_type: string | null;
  status: string;
  final_url: string | null;
  headline: string | null;
  description: string | null;
  video_id: string | null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  return null;
}

export function parseCampaignRow(row: unknown): CampaignParsed | null {
  if (!isObj(row)) return null;
  const c = row.campaign;
  if (!isObj(c)) return null;
  const id = asString(c.id);
  const name = asString(c.name);
  if (!id || !name) return null;

  const budget = isObj(row.campaignBudget) ? asNumber(row.campaignBudget.amountMicros) : null;
  return {
    google_campaign_id: id,
    name,
    campaign_type: asString(c.advertisingChannelType),
    status: asString(c.status) ?? 'UNKNOWN',
    bidding_strategy: asString(c.biddingStrategyType),
    daily_budget_micros: budget,
    start_date: asString(c.startDate),
    end_date: asString(c.endDate),
  };
}

export function parseAdGroupRow(row: unknown, campaignId: string): AdGroupParsed | null {
  if (!isObj(row)) return null;
  const ag = row.adGroup;
  if (!isObj(ag)) return null;
  const id = asString(ag.id);
  const name = asString(ag.name);
  if (!id || !name) return null;
  return {
    campaign_id: campaignId,
    google_ad_group_id: id,
    name,
    status: asString(ag.status) ?? 'UNKNOWN',
    type: asString(ag.type),
    cpc_bid_micros: asNumber(ag.cpcBidMicros),
    entity_type: 'AD_GROUP',
    metadata: null,
  };
}

export function parseAdRow(row: unknown, adGroupId: string): AdParsed | null {
  if (!isObj(row)) return null;
  const aga = row.adGroupAd;
  if (!isObj(aga)) return null;
  const ad = aga.ad;
  if (!isObj(ad)) return null;
  const id = asString(ad.id);
  if (!id) return null;

  const finalUrls = ad.finalUrls;
  const finalUrl = Array.isArray(finalUrls) && typeof finalUrls[0] === 'string' ? finalUrls[0] : null;

  let headline: string | null = null;
  let description: string | null = null;
  if (isObj(ad.responsiveDisplayAd)) {
    const h = ad.responsiveDisplayAd.headlines;
    const d = ad.responsiveDisplayAd.descriptions;
    if (Array.isArray(h) && isObj(h[0])) headline = asString(h[0].text);
    if (Array.isArray(d) && isObj(d[0])) description = asString(d[0].text);
  }

  let videoId: string | null = null;
  if (isObj(ad.videoResponsiveAd)) {
    const vids = ad.videoResponsiveAd.videos;
    if (Array.isArray(vids) && isObj(vids[0])) {
      videoId = asString(vids[0].value) ?? asString(vids[0].asset);
    }
  }

  return {
    ad_group_id: adGroupId,
    google_ad_id: id,
    name: asString(ad.name),
    ad_type: asString(ad.type),
    status: asString(aga.status) ?? 'UNKNOWN',
    final_url: finalUrl,
    headline,
    description,
    video_id: videoId,
  };
}

export function parseAssetGroupRow(row: unknown, campaignId: string): AdGroupParsed | null {
  if (!isObj(row)) return null;
  const ag = row.assetGroup;
  if (!isObj(ag)) return null;
  const id = asString(ag.id);
  const name = asString(ag.name);
  if (!id || !name) return null;
  return {
    campaign_id: campaignId,
    google_ad_group_id: id,
    name,
    status: asString(ag.status) ?? 'UNKNOWN',
    type: null,
    cpc_bid_micros: null,
    entity_type: 'ASSET_GROUP',
    metadata: {
      final_urls: Array.isArray(ag.finalUrls) ? ag.finalUrls : null,
    },
  };
}
