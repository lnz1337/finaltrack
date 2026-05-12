// GAQL queries pra Google Ads API v23.
// Usar templates pra interpolar resource names (campaign='customers/X/campaigns/Y').
// Status filter inclui REMOVED pra que sync detecte e refletida via mark_removed.

export const CAMPAIGN_QUERY = `
SELECT
  campaign.id, campaign.name, campaign.advertising_channel_type,
  campaign.status, campaign.bidding_strategy_type,
  campaign_budget.amount_micros,
  campaign.start_date, campaign.end_date
FROM campaign
WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
`.trim();

export function adGroupQuery(campaignResource: string): string {
  return `
SELECT
  ad_group.id, ad_group.name, ad_group.status, ad_group.type,
  ad_group.cpc_bid_micros, ad_group.campaign
FROM ad_group
WHERE ad_group.campaign = '${campaignResource}'
  AND ad_group.status IN ('ENABLED', 'PAUSED', 'REMOVED')
`.trim();
}

export function adQuery(adGroupResource: string): string {
  return `
SELECT
  ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
  ad_group_ad.status, ad_group_ad.ad.final_urls,
  ad_group_ad.ad.responsive_display_ad.headlines,
  ad_group_ad.ad.responsive_display_ad.descriptions,
  ad_group_ad.ad.video_responsive_ad.videos,
  ad_group_ad.ad_group
FROM ad_group_ad
WHERE ad_group_ad.ad_group = '${adGroupResource}'
  AND ad_group_ad.status IN ('ENABLED', 'PAUSED', 'REMOVED')
`.trim();
}

export function assetGroupQuery(campaignResource: string): string {
  return `
SELECT
  asset_group.id, asset_group.name, asset_group.status,
  asset_group.campaign, asset_group.final_urls
FROM asset_group
WHERE asset_group.campaign = '${campaignResource}'
  AND asset_group.status IN ('ENABLED', 'PAUSED', 'REMOVED')
`.trim();
}
