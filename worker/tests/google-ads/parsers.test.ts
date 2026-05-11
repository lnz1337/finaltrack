import { describe, it, expect } from 'vitest';
import {
  parseCampaignRow,
  parseAdGroupRow,
  parseAdRow,
  parseAssetGroupRow,
} from '../../src/lib/google-ads/parsers';

describe('parseCampaignRow', () => {
  it('parseia row válida', () => {
    const row = {
      campaign: {
        id: '12345',
        name: 'Black Friday',
        advertisingChannelType: 'SEARCH',
        status: 'ENABLED',
        biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
      campaignBudget: { amountMicros: '50000000' },
    };
    const parsed = parseCampaignRow(row);
    expect(parsed).toEqual({
      google_campaign_id: '12345',
      name: 'Black Friday',
      campaign_type: 'SEARCH',
      status: 'ENABLED',
      bidding_strategy: 'MAXIMIZE_CONVERSIONS',
      daily_budget_micros: 50000000,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
  });

  it('retorna null quando campaign.id ausente', () => {
    expect(parseCampaignRow({ campaign: { name: 'no id' } })).toBeNull();
  });

  it('retorna null em row null/undefined/non-object', () => {
    expect(parseCampaignRow(null)).toBeNull();
    expect(parseCampaignRow(undefined)).toBeNull();
    expect(parseCampaignRow('string')).toBeNull();
  });

  it('amount_micros ausente vira null', () => {
    const row = { campaign: { id: '1', name: 'x', status: 'ENABLED' } };
    expect(parseCampaignRow(row)?.daily_budget_micros).toBeNull();
  });
});

describe('parseAdGroupRow', () => {
  it('parseia row válida com entity_type=AD_GROUP default', () => {
    const row = {
      adGroup: {
        id: '999',
        name: 'AG-1',
        status: 'ENABLED',
        type: 'SEARCH_STANDARD',
        cpcBidMicros: '1000000',
        campaign: 'customers/123/campaigns/12345',
      },
    };
    const parsed = parseAdGroupRow(row, '00000000-0000-0000-0000-00000000c001');
    expect(parsed).toMatchObject({
      campaign_id: '00000000-0000-0000-0000-00000000c001',
      google_ad_group_id: '999',
      name: 'AG-1',
      type: 'SEARCH_STANDARD',
      status: 'ENABLED',
      cpc_bid_micros: 1000000,
      entity_type: 'AD_GROUP',
    });
  });

  it('retorna null quando id ausente', () => {
    expect(parseAdGroupRow({ adGroup: { name: 'x' } }, 'cid')).toBeNull();
  });
});

describe('parseAdRow', () => {
  it('parseia row de RESPONSIVE_DISPLAY_AD', () => {
    const row = {
      adGroupAd: {
        ad: {
          id: '500',
          name: 'Ad-1',
          type: 'RESPONSIVE_DISPLAY_AD',
          finalUrls: ['https://example.com'],
          responsiveDisplayAd: {
            headlines: [{ text: 'Headline 1' }],
            descriptions: [{ text: 'Desc 1' }],
          },
        },
        status: 'ENABLED',
        adGroup: 'customers/123/adGroups/999',
      },
    };
    const parsed = parseAdRow(row, '00000000-0000-0000-0000-00000000ag01');
    expect(parsed).toMatchObject({
      ad_group_id: '00000000-0000-0000-0000-00000000ag01',
      google_ad_id: '500',
      name: 'Ad-1',
      ad_type: 'RESPONSIVE_DISPLAY_AD',
      status: 'ENABLED',
      final_url: 'https://example.com',
      headline: 'Headline 1',
      description: 'Desc 1',
    });
  });

  it('parseia row de VIDEO_RESPONSIVE_AD com video_id', () => {
    const row = {
      adGroupAd: {
        ad: {
          id: '600',
          type: 'VIDEO_RESPONSIVE_AD',
          videoResponsiveAd: { videos: [{ asset: 'customers/x/assets/abc', value: 'YT_VIDEO_ID_123' }] },
        },
        status: 'ENABLED',
      },
    };
    const parsed = parseAdRow(row, 'ag-id');
    expect(parsed?.video_id).toBeTruthy();
  });

  it('retorna null quando ad.id ausente', () => {
    expect(parseAdRow({ adGroupAd: { ad: {} } }, 'ag')).toBeNull();
  });
});

describe('parseAssetGroupRow', () => {
  it('parseia asset_group como ad_group entity_type=ASSET_GROUP', () => {
    const row = {
      assetGroup: {
        id: '888',
        name: 'PMax-AG-1',
        status: 'ENABLED',
        campaign: 'customers/123/campaigns/777',
        finalUrls: ['https://example.com'],
      },
    };
    const parsed = parseAssetGroupRow(row, '00000000-0000-0000-0000-00000000c777');
    expect(parsed).toMatchObject({
      campaign_id: '00000000-0000-0000-0000-00000000c777',
      google_ad_group_id: '888',
      name: 'PMax-AG-1',
      status: 'ENABLED',
      entity_type: 'ASSET_GROUP',
      metadata: { final_urls: ['https://example.com'] },
    });
  });

  it('retorna null quando id ausente', () => {
    expect(parseAssetGroupRow({ assetGroup: {} }, 'cid')).toBeNull();
  });
});
