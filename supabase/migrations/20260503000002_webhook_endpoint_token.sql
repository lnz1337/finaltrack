-- Adiciona endpoint_token a webhook_secrets pra rotear webhooks
-- sem precisar de slug visível ou header customizado.
--
-- ATENÇÃO PROD: O DEFAULT 'gen_random_bytes(24)' usado em ALTER ADD COLUMN é volatile.
-- Em prod (com volume de dados), Postgres bloqueia a tabela durante o backfill, gerando downtime.
-- Pra prod, splittar em 3 statements:
--   1. ALTER TABLE webhook_secrets ADD COLUMN endpoint_token TEXT;
--   2. UPDATE webhook_secrets SET endpoint_token = encode(gen_random_bytes(24), 'hex') WHERE endpoint_token IS NULL;
--   3. ALTER TABLE webhook_secrets ALTER COLUMN endpoint_token SET NOT NULL;
-- Em dev, single-statement aceitável e já aplicado.

BEGIN;

ALTER TABLE webhook_secrets
  ADD COLUMN endpoint_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex');

ALTER TABLE webhook_secrets
  ADD CONSTRAINT webhook_secrets_endpoint_token_unique UNIQUE (endpoint_token);

CREATE INDEX idx_webhook_secrets_endpoint_token ON webhook_secrets(endpoint_token);

COMMIT;
