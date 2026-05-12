-- LeoTracker — Migration 005
-- Phase 2A post-patch: substituir idx_adgroups_entity_type por partial index
-- Postgres 15+ · Supabase compatible

-- Motivação:
-- Migration 004 criou idx_adgroups_entity_type cobrindo 2 valores ('AD_GROUP', 'ASSET_GROUP')
-- onde 'AD_GROUP' será a vasta maioria das rows. Postgres provavelmente vai ignorar esse
-- índice low-selectivity em queries reais. Partial index sobre 'ASSET_GROUP' (minoria)
-- cobre só as queries que importam (listar asset_groups de uma conta), ocupa muito menos
-- espaço e tem chance real de ser usado pelo planner.

BEGIN;

CREATE INDEX idx_adgroups_asset_group
  ON ad_groups(entity_type)
  WHERE entity_type = 'ASSET_GROUP';

DROP INDEX idx_adgroups_entity_type;

COMMIT;
