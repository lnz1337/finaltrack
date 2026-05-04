-- Seed local — NUNCA rodar em prod.
-- Cria 1 auth user (UUID fixo) + 1 workspace + offers + webhook_secrets com endpoint_token previsível.
--
-- Design decision: auth.users é inserido diretamente aqui (não via curl Admin API)
-- pra que o seed seja self-contained e re-runnável após qualquer `supabase db reset`.
-- O UUID do dev user é fixo: 00000000-0000-0000-0000-00000000000a
--
-- Para fazer login nesse user no Studio/client use:
--   email: dev@finaltrack.local   password: devdev123

BEGIN;

-- Dev user no auth.users (UUID fixo, re-runnável)
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-0000-0000-00000000000a',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'dev@finaltrack.local',
  '$2a$06$vRBtcbCfHqrl7z7SCNI0mexmngsJIRwAUPYP4Ws.iFPkLzmkv7HQy',  -- bcrypt('devdev123')
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  FALSE,
  FALSE,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Workspace dev
INSERT INTO workspaces (id, name, slug, owner_id, timezone, default_currency)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Dev Workspace',
  'dev',
  '00000000-0000-0000-0000-00000000000a',
  'America/Sao_Paulo',
  'BRL'
)
ON CONFLICT (id) DO NOTHING;

-- Offer Kiwify de teste
INSERT INTO offers (id, workspace_id, name, checkout_platform, external_product_id, default_currency, cogs_pct)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Té Drenador (Kiwify)',
  'kiwify',
  'kiwify-product-1',
  'BRL',
  0.30
)
ON CONFLICT (id) DO NOTHING;

-- Offer Hotmart de teste
INSERT INTO offers (id, workspace_id, name, checkout_platform, external_product_id, default_currency, cogs_pct)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  'Té Drenador (Hotmart)',
  'hotmart',
  'hotmart-product-1',
  'BRL',
  0.30
)
ON CONFLICT (id) DO NOTHING;

-- webhook_secrets — secret_encrypted é placeholder; vamos sobrescrever via app real.
-- Pra dev, vamos validar HMAC contra o plaintext direto (definido em wrangler.toml.example como var pública pra dev).
-- endpoint_token previsível pra facilitar curl manual.
INSERT INTO webhook_secrets (workspace_id, platform, secret_encrypted, secret_iv, endpoint_token)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'kiwify',
    'DEV_PLACEHOLDER_ENCRYPTED',
    'DEV_PLACEHOLDER_IV',
    'dev_kiwify_token_aaaaaaaaaaaaaaaa'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'hotmart',
    'DEV_PLACEHOLDER_ENCRYPTED',
    'DEV_PLACEHOLDER_IV',
    'dev_hotmart_token_bbbbbbbbbbbbbbbb'
  )
ON CONFLICT (workspace_id, platform) DO NOTHING;

COMMIT;
