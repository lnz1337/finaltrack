-- LeoTracker — Migration 004
-- Phase 2A: Google Ads metadata sync (OAuth + connect + read foundation)
-- Postgres 15+ · Supabase compatible

BEGIN;

-- ==========================================================================
-- 4.1 — ad_groups: entity_type + metadata
-- ==========================================================================
-- entity_type='AD_GROUP': ad_groups normais de Search/Display/Video/Shopping.
-- entity_type='ASSET_GROUP': asset_groups de PMax/DG reusados nesta tabela
--   (decisão β/3.B.5.3: importa containers, não importa creative-level
--    asset_group_assets — fica pra Fase 2D).
-- metadata JSONB: na 2A geralmente NULL. Reservado pra capturar specifics
--   de asset_groups (final_urls, channel) sem ALTER TABLE futuro.

ALTER TABLE ad_groups
  ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'AD_GROUP'
    CHECK (entity_type IN ('AD_GROUP', 'ASSET_GROUP')),
  ADD COLUMN metadata JSONB;

CREATE INDEX idx_adgroups_entity_type ON ad_groups(entity_type);

-- ==========================================================================
-- 4.2 — cost_sync_log → google_ads_sync_log (rename + extend)
-- ==========================================================================
ALTER TABLE cost_sync_log RENAME TO google_ads_sync_log;
ALTER INDEX idx_cost_sync_log_account_time
  RENAME TO idx_google_ads_sync_log_account_time;

ALTER TABLE google_ads_sync_log
  ADD COLUMN sync_type TEXT NOT NULL DEFAULT 'cost'
    CHECK (sync_type IN ('metadata', 'cost')),
  ADD COLUMN partial_skipped JSONB,
  ADD COLUMN trace_id UUID,
  ADD COLUMN parsed_skipped INTEGER DEFAULT 0,
  ADD CONSTRAINT google_ads_sync_log_status_check
    CHECK (status IN ('running', 'success', 'partial', 'failed'));

CREATE INDEX idx_google_ads_sync_log_trace
  ON google_ads_sync_log(trace_id) WHERE trace_id IS NOT NULL;

DROP POLICY IF EXISTS "workspace_member_read_cost_log" ON google_ads_sync_log;
CREATE POLICY "workspace_member_read_sync_log" ON google_ads_sync_log
  FOR SELECT USING (
    google_ads_account_id IN (
      SELECT id FROM google_ads_accounts
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    )
  );

-- ==========================================================================
-- 4.3 — oauth_pending_selections (NEW)
-- ==========================================================================
CREATE TABLE oauth_pending_selections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  CHECK (expires_at > created_at)
);

CREATE INDEX idx_oauth_pending_expires ON oauth_pending_selections(expires_at);
CREATE INDEX idx_oauth_pending_workspace ON oauth_pending_selections(workspace_id);

ALTER TABLE oauth_pending_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_owner_read_oauth_pending" ON oauth_pending_selections
  FOR SELECT USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

-- ==========================================================================
-- 4.4 — RPC mark_removed_for_account
-- ==========================================================================
CREATE OR REPLACE FUNCTION mark_removed_for_account(
  p_account_id UUID,
  p_started_at TIMESTAMPTZ
)
RETURNS TABLE (
  campaigns_marked INTEGER,
  ad_groups_marked INTEGER,
  ads_marked INTEGER
)
LANGUAGE plpgsql AS $$
DECLARE
  v_campaigns INTEGER;
  v_ad_groups INTEGER;
  v_ads INTEGER;
BEGIN
  UPDATE campaigns
     SET status = 'REMOVED'
   WHERE google_ads_account_id = p_account_id
     AND last_synced_at < p_started_at
     AND status != 'REMOVED';
  GET DIAGNOSTICS v_campaigns = ROW_COUNT;

  UPDATE ad_groups
     SET status = 'REMOVED'
   WHERE campaign_id IN (
     SELECT id FROM campaigns WHERE google_ads_account_id = p_account_id
   )
     AND last_synced_at < p_started_at
     AND status != 'REMOVED';
  GET DIAGNOSTICS v_ad_groups = ROW_COUNT;

  UPDATE ads
     SET status = 'REMOVED'
   WHERE ad_group_id IN (
     SELECT ag.id FROM ad_groups ag
     JOIN campaigns c ON c.id = ag.campaign_id
     WHERE c.google_ads_account_id = p_account_id
   )
     AND last_synced_at < p_started_at
     AND status != 'REMOVED';
  GET DIAGNOSTICS v_ads = ROW_COUNT;

  RETURN QUERY SELECT v_campaigns, v_ad_groups, v_ads;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_removed_for_account(UUID, TIMESTAMPTZ) TO service_role;

COMMIT;
