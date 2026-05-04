-- Adiciona endpoint_token a webhook_secrets pra rotear webhooks
-- sem precisar de slug visível ou header customizado.

BEGIN;

ALTER TABLE webhook_secrets
  ADD COLUMN endpoint_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex');

ALTER TABLE webhook_secrets
  ADD CONSTRAINT webhook_secrets_endpoint_token_unique UNIQUE (endpoint_token);

CREATE INDEX idx_webhook_secrets_endpoint_token ON webhook_secrets(endpoint_token);

COMMIT;
