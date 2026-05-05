-- 003: Add is_test flag to conversions
-- Payt webhook envia eventos com test:bool flag (top-level body.test).
-- Salvamos pra distinguir conversões reais de testes na UI/dashboard.
-- Outros webhooks (Kiwify, Hotmart) hardcodam is_test=false defensivamente
-- até expor flag equivalente.
--
-- DEFAULT false é estável (NÃO-volatile) — Postgres não reescreve a tabela
-- durante backfill. Seguro em prod sem split.
--
-- Index parcial em is_test=true (cardinalidade baixa esperada — testes são
-- minoria). Workspace-scoped pra usar em filtros do dashboard sem fullscan.

BEGIN;

ALTER TABLE conversions
  ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_conversions_is_test
  ON conversions(workspace_id, is_test) WHERE is_test = true;

COMMIT;
