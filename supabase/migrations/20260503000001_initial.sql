-- LeoTracker — Initial Schema (v2 · Google Ads Only)
-- Postgres 15+ · Supabase compatible · RLS enabled
-- 13 tables, simplified from v1 (Meta refs removed)

BEGIN;

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. WORKSPACES (multi-tenant root)
-- ============================================================================
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  default_currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);

-- ============================================================================
-- 2. GOOGLE_ADS_ACCOUNTS (OAuth + customer_id)
-- ============================================================================
CREATE TABLE google_ads_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  manager_customer_id TEXT,
  account_name TEXT,
  currency TEXT DEFAULT 'USD',
  refresh_token_encrypted TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, customer_id)
);

CREATE INDEX idx_gads_workspace ON google_ads_accounts(workspace_id);

-- ============================================================================
-- 3. CAMPAIGNS (synced from Google Ads API)
-- ============================================================================
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_ads_account_id UUID NOT NULL REFERENCES google_ads_accounts(id) ON DELETE CASCADE,
  google_campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  campaign_type TEXT,  -- SEARCH, DEMAND_GEN, VIDEO, PERFORMANCE_MAX, DISPLAY, SHOPPING
  status TEXT,         -- ENABLED, PAUSED, REMOVED
  daily_budget_micros BIGINT,
  bidding_strategy TEXT,
  start_date DATE,
  end_date DATE,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(google_ads_account_id, google_campaign_id)
);

CREATE INDEX idx_campaigns_gads_account ON campaigns(google_ads_account_id);
CREATE INDEX idx_campaigns_status ON campaigns(status) WHERE status = 'ENABLED';

-- ============================================================================
-- 4. AD_GROUPS (or asset_groups for DG/PMax)
-- ============================================================================
CREATE TABLE ad_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  google_ad_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT,
  type TEXT,           -- SEARCH_STANDARD, DISPLAY_STANDARD, VIDEO_RESPONSIVE, etc.
  cpc_bid_micros BIGINT,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, google_ad_group_id)
);

CREATE INDEX idx_adgroups_campaign ON ad_groups(campaign_id);

-- ============================================================================
-- 5. ADS (creative-level)
-- ============================================================================
CREATE TABLE ads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ad_group_id UUID NOT NULL REFERENCES ad_groups(id) ON DELETE CASCADE,
  google_ad_id TEXT NOT NULL,
  name TEXT,
  ad_type TEXT,        -- VIDEO_AD, RESPONSIVE_DISPLAY_AD, EXPANDED_TEXT_AD, etc.
  status TEXT,
  preview_url TEXT,
  final_url TEXT,
  headline TEXT,
  description TEXT,
  video_id TEXT,       -- YouTube video ID for VIDEO_AD
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ad_group_id, google_ad_id)
);

CREATE INDEX idx_ads_adgroup ON ads(ad_group_id);

-- ============================================================================
-- 6. OFFERS (products being promoted)
-- ============================================================================
CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  checkout_platform TEXT NOT NULL,  -- kiwify, hotmart, buygoods, clickbank, cartpanda, stripe, pepper, digistorex
  external_product_id TEXT,
  default_currency TEXT DEFAULT 'USD',
  cogs_pct NUMERIC,    -- cost of goods sold % (pra calcular profit real)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_offers_workspace ON offers(workspace_id);

-- ============================================================================
-- 7. CLICKS (the heart of the tracker)
-- ============================================================================
CREATE TABLE clicks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  click_id TEXT NOT NULL UNIQUE,  -- our internal ID, propagated to checkout
  visitor_id TEXT NOT NULL,        -- first-party cookie UUID
  session_id TEXT,                 -- session-level identifier

  -- Google click identifiers
  gclid TEXT,
  wbraid TEXT,
  gbraid TEXT,
  gclsrc TEXT,
  gad_source TEXT,
  gad_campaignid TEXT,

  -- UTMs (raw)
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,

  -- UTMify-style pipe format parsed (Name|ID)
  campaign_id_parsed TEXT,
  campaign_name_parsed TEXT,
  adset_id_parsed TEXT,
  adset_name_parsed TEXT,
  ad_id_parsed TEXT,
  ad_name_parsed TEXT,

  -- Correlation with synced Google Ads entities (resolved at write time when possible)
  google_campaign_id TEXT,
  google_ad_group_id TEXT,
  google_ad_id TEXT,

  -- Request metadata
  ip INET,
  user_agent TEXT,
  referrer TEXT,
  landing_url TEXT NOT NULL,
  country TEXT,         -- ISO 3166-1 alpha-2
  region TEXT,
  city TEXT,
  device_type TEXT,     -- desktop, mobile, tablet
  os TEXT,
  browser TEXT,

  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clicks_gclid ON clicks(gclid) WHERE gclid IS NOT NULL;
CREATE INDEX idx_clicks_wbraid ON clicks(wbraid) WHERE wbraid IS NOT NULL;
CREATE INDEX idx_clicks_gbraid ON clicks(gbraid) WHERE gbraid IS NOT NULL;
CREATE INDEX idx_clicks_visitor ON clicks(visitor_id);
CREATE INDEX idx_clicks_workspace_time ON clicks(workspace_id, clicked_at DESC);
CREATE INDEX idx_clicks_google_campaign ON clicks(google_campaign_id) WHERE google_campaign_id IS NOT NULL;

-- ============================================================================
-- 8. VIDEO_EVENTS (VSL milestones tied to clicks)
-- ============================================================================
CREATE TABLE video_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  click_id TEXT NOT NULL REFERENCES clicks(click_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,  -- play, 3s, p25, p50, p75, pitch_view, cta_click
  video_id TEXT,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_video_events_click ON video_events(click_id);
CREATE INDEX idx_video_events_type_time ON video_events(event_type, occurred_at DESC);

-- ============================================================================
-- 9. CONVERSIONS (from checkout webhooks)
-- ============================================================================
CREATE TABLE conversions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  click_id TEXT REFERENCES clicks(click_id) ON DELETE SET NULL,
  offer_id UUID REFERENCES offers(id) ON DELETE SET NULL,

  external_order_id TEXT NOT NULL,
  conversion_type TEXT NOT NULL,  -- pix_generated, billet_generated, paid, refund, chargeback, abandoned
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',

  -- For Enhanced Conversions (SHA256 hashed before storage)
  customer_email_hash TEXT,
  customer_phone_hash TEXT,
  customer_first_name_hash TEXT,
  customer_last_name_hash TEXT,

  -- Match diagnostics
  match_method TEXT,  -- 'click_id', 'gclid_in_payload', 'soft_match_email', 'unmatched'

  raw_payload JSONB,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(workspace_id, external_order_id, conversion_type)
);

CREATE INDEX idx_conversions_workspace_time ON conversions(workspace_id, occurred_at DESC);
CREATE INDEX idx_conversions_click ON conversions(click_id) WHERE click_id IS NOT NULL;
CREATE INDEX idx_conversions_offer ON conversions(offer_id);

-- ============================================================================
-- 10. CONVERSION_UPLOADS (Enhanced Conv / Offline Conv Import status)
-- ============================================================================
CREATE TABLE conversion_uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversion_id UUID NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
  google_ads_account_id UUID NOT NULL REFERENCES google_ads_accounts(id) ON DELETE CASCADE,
  conversion_action_id TEXT,  -- Google Ads conversion action resource name

  status TEXT NOT NULL DEFAULT 'pending',  -- pending, sent, success, failed
  attempt_count INTEGER DEFAULT 0,
  last_error TEXT,
  google_response JSONB,

  attempted_at TIMESTAMPTZ,
  succeeded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conv_uploads_status ON conversion_uploads(status) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_conv_uploads_conversion ON conversion_uploads(conversion_id);

-- ============================================================================
-- 11. COST_DATA (daily rollup from Google Ads API)
-- ============================================================================
CREATE TABLE cost_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_ads_account_id UUID NOT NULL REFERENCES google_ads_accounts(id) ON DELETE CASCADE,
  google_campaign_id TEXT NOT NULL,
  google_ad_group_id TEXT,
  google_ad_id TEXT,
  date DATE NOT NULL,

  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  cost_micros BIGINT DEFAULT 0,
  currency TEXT,
  view_through_conversions INTEGER DEFAULT 0,
  conversions_reported_by_google INTEGER DEFAULT 0,
  conversion_value_reported_by_google NUMERIC DEFAULT 0,

  synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_cost_data_unique ON cost_data(google_ads_account_id, google_campaign_id, COALESCE(google_ad_group_id, ''), COALESCE(google_ad_id, ''), date);
CREATE INDEX idx_cost_account_date ON cost_data(google_ads_account_id, date DESC);
CREATE INDEX idx_cost_campaign_date ON cost_data(google_campaign_id, date DESC);

-- ============================================================================
-- 12. COST_SYNC_LOG (audit trail)
-- ============================================================================
CREATE TABLE cost_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_ads_account_id UUID NOT NULL REFERENCES google_ads_accounts(id) ON DELETE CASCADE,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  rows_synced INTEGER DEFAULT 0,
  status TEXT NOT NULL,  -- running, success, failed
  error_message TEXT,
  triggered_by TEXT,     -- on_demand, cron, manual
  duration_ms INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_cost_sync_log_account_time ON cost_sync_log(google_ads_account_id, started_at DESC);

-- ============================================================================
-- 13. WEBHOOK_SECRETS (HMAC keys per checkout platform)
-- ============================================================================
CREATE TABLE webhook_secrets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,  -- kiwify, hotmart, buygoods, etc.
  secret_encrypted TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, platform)
);

CREATE INDEX idx_webhook_secrets_workspace ON webhook_secrets(workspace_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Daily metrics rollup (used by dashboard)
CREATE OR REPLACE FUNCTION daily_metrics(
  p_workspace_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  date DATE,
  spend NUMERIC,
  revenue NUMERIC,
  conversions BIGINT,
  clicks BIGINT,
  impressions BIGINT
)
LANGUAGE SQL STABLE AS $$
  WITH cost_agg AS (
    SELECT
      cd.date,
      SUM(cd.cost_micros) / 1000000.0 AS spend,
      SUM(cd.clicks) AS clicks,
      SUM(cd.impressions) AS impressions
    FROM cost_data cd
    JOIN google_ads_accounts gaa ON gaa.id = cd.google_ads_account_id
    WHERE gaa.workspace_id = p_workspace_id
      AND cd.date BETWEEN p_start_date AND p_end_date
    GROUP BY cd.date
  ),
  conv_agg AS (
    SELECT
      occurred_at::DATE AS date,
      SUM(amount) FILTER (WHERE conversion_type = 'paid') AS revenue,
      COUNT(*) FILTER (WHERE conversion_type = 'paid') AS conversions
    FROM conversions
    WHERE workspace_id = p_workspace_id
      AND occurred_at::DATE BETWEEN p_start_date AND p_end_date
    GROUP BY occurred_at::DATE
  )
  SELECT
    COALESCE(c.date, v.date) AS date,
    COALESCE(c.spend, 0) AS spend,
    COALESCE(v.revenue, 0) AS revenue,
    COALESCE(v.conversions, 0) AS conversions,
    COALESCE(c.clicks, 0) AS clicks,
    COALESCE(c.impressions, 0) AS impressions
  FROM cost_agg c
  FULL OUTER JOIN conv_agg v ON c.date = v.date
  ORDER BY date;
$$;

-- Creative-level metrics for 1-1-1 view
CREATE OR REPLACE FUNCTION creative_metrics(
  p_workspace_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  ad_id UUID,
  google_ad_id TEXT,
  ad_name TEXT,
  campaign_name TEXT,
  impressions BIGINT,
  clicks BIGINT,
  spend NUMERIC,
  conversions BIGINT,
  revenue NUMERIC,
  cpa NUMERIC,
  roas NUMERIC
)
LANGUAGE SQL STABLE AS $$
  SELECT
    a.id AS ad_id,
    a.google_ad_id,
    a.name AS ad_name,
    c.name AS campaign_name,
    COALESCE(SUM(cd.impressions), 0) AS impressions,
    COALESCE(SUM(cd.clicks), 0) AS clicks,
    COALESCE(SUM(cd.cost_micros) / 1000000.0, 0) AS spend,
    COUNT(DISTINCT cv.id) FILTER (WHERE cv.conversion_type = 'paid') AS conversions,
    COALESCE(SUM(cv.amount) FILTER (WHERE cv.conversion_type = 'paid'), 0) AS revenue,
    CASE
      WHEN COUNT(DISTINCT cv.id) FILTER (WHERE cv.conversion_type = 'paid') > 0
      THEN (SUM(cd.cost_micros) / 1000000.0) / COUNT(DISTINCT cv.id) FILTER (WHERE cv.conversion_type = 'paid')
      ELSE NULL
    END AS cpa,
    CASE
      WHEN SUM(cd.cost_micros) > 0
      THEN COALESCE(SUM(cv.amount) FILTER (WHERE cv.conversion_type = 'paid'), 0) / (SUM(cd.cost_micros) / 1000000.0)
      ELSE NULL
    END AS roas
  FROM ads a
  JOIN ad_groups ag ON ag.id = a.ad_group_id
  JOIN campaigns c ON c.id = ag.campaign_id
  JOIN google_ads_accounts gaa ON gaa.id = c.google_ads_account_id
  LEFT JOIN cost_data cd
    ON cd.google_ad_id = a.google_ad_id
    AND cd.date BETWEEN p_start_date AND p_end_date
  LEFT JOIN clicks ck
    ON ck.google_ad_id = a.google_ad_id
    AND ck.clicked_at::DATE BETWEEN p_start_date AND p_end_date
  LEFT JOIN conversions cv
    ON cv.click_id = ck.click_id
    AND cv.occurred_at::DATE BETWEEN p_start_date AND p_end_date
  WHERE gaa.workspace_id = p_workspace_id
  GROUP BY a.id, a.google_ad_id, a.name, c.name
  ORDER BY spend DESC;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_ads_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversion_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_secrets ENABLE ROW LEVEL SECURITY;

-- Owner can do everything in their workspace
CREATE POLICY "owner_full_access_workspaces" ON workspaces
  FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "workspace_member_read_gads" ON google_ads_accounts
  FOR SELECT USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE POLICY "workspace_member_read_campaigns" ON campaigns
  FOR SELECT USING (
    google_ads_account_id IN (
      SELECT id FROM google_ads_accounts
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "workspace_member_read_adgroups" ON ad_groups
  FOR SELECT USING (
    campaign_id IN (
      SELECT c.id FROM campaigns c
      JOIN google_ads_accounts gaa ON gaa.id = c.google_ads_account_id
      WHERE gaa.workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "workspace_member_read_ads" ON ads
  FOR SELECT USING (
    ad_group_id IN (
      SELECT ag.id FROM ad_groups ag
      JOIN campaigns c ON c.id = ag.campaign_id
      JOIN google_ads_accounts gaa ON gaa.id = c.google_ads_account_id
      WHERE gaa.workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "workspace_owner_offers" ON offers
  FOR ALL USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE POLICY "workspace_member_read_clicks" ON clicks
  FOR SELECT USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE POLICY "workspace_member_read_video_events" ON video_events
  FOR SELECT USING (
    click_id IN (
      SELECT click_id FROM clicks
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "workspace_member_read_conversions" ON conversions
  FOR SELECT USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE POLICY "workspace_member_read_conv_uploads" ON conversion_uploads
  FOR SELECT USING (
    conversion_id IN (
      SELECT id FROM conversions
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "workspace_member_read_cost" ON cost_data
  FOR SELECT USING (
    google_ads_account_id IN (
      SELECT id FROM google_ads_accounts
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "workspace_member_read_cost_log" ON cost_sync_log
  FOR SELECT USING (
    google_ads_account_id IN (
      SELECT id FROM google_ads_accounts
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "workspace_owner_webhook_secrets" ON webhook_secrets
  FOR ALL USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

-- Note: Worker uses service_role key, which bypasses RLS for INSERT/UPDATE.
-- RLS above governs the dashboard (anon/authenticated keys).

COMMIT;
