#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# scripts/setup-dev.sh
# (Re)set the local Supabase DB and populate it with dev fixtures.
#
# Orchestration order (constraint: workspaces.owner_id references auth.users):
#   1. supabase db reset  -> applies migrations 001 + 002 only; wipes auth.users
#   2. curl admin API     -> creates dev@finaltrack.local with fixed UUID
#   3. psql               -> inserts workspace + offers + webhook_secrets
# =============================================================================

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DEV_USER_ID="00000000-0000-0000-0000-00000000000a"
DEV_EMAIL="dev@finaltrack.local"
DEV_PASSWORD="devdev123"

SUPABASE_AUTH_URL="http://127.0.0.1:54321/auth/v1/admin/users"
SERVICE_ROLE_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

DB_CONTAINER="supabase_db_FinalTrack"
DB_USER="postgres"
DB_NAME="postgres"

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
echo "==> Checking prerequisites"

if ! command -v supabase &>/dev/null; then
  echo "ERROR: supabase CLI not found. Install it and try again." >&2
  exit 1
fi

if ! command -v curl &>/dev/null; then
  echo "ERROR: curl not found." >&2
  exit 1
fi

if ! docker ps --filter "name=^${DB_CONTAINER}$" --format "{{.Names}}" | grep -q "${DB_CONTAINER}"; then
  echo "ERROR: Docker container '${DB_CONTAINER}' is not running." >&2
  echo "       Run 'pnpm db:start' (or 'supabase start') first." >&2
  exit 1
fi

echo "    OK: supabase CLI, curl, docker all present and DB container running."

# ---------------------------------------------------------------------------
# Step 1: Reset DB (applies migrations 001 + 002; no seed)
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 1: supabase db reset (applies migrations only)"
supabase db reset --no-seed
echo "    DB reset complete."

# ---------------------------------------------------------------------------
# Step 2: Create dev user via GoTrue admin API
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 2: Creating dev user via admin API"
echo "    Email   : ${DEV_EMAIL}"
echo "    UUID    : ${DEV_USER_ID}"

HTTP_RESPONSE=$(curl --silent --write-out "HTTPSTATUS:%{http_code}" \
  --request POST "${SUPABASE_AUTH_URL}" \
  --header "Content-Type: application/json" \
  --header "apikey: ${SERVICE_ROLE_JWT}" \
  --header "Authorization: Bearer ${SERVICE_ROLE_JWT}" \
  --data "{
    \"id\": \"${DEV_USER_ID}\",
    \"email\": \"${DEV_EMAIL}\",
    \"password\": \"${DEV_PASSWORD}\",
    \"email_confirm\": true
  }")

HTTP_BODY=$(echo "${HTTP_RESPONSE}" | sed 's/HTTPSTATUS:[0-9]*$//')
HTTP_CODE=$(echo "${HTTP_RESPONSE}" | grep -oP 'HTTPSTATUS:\K[0-9]+')

if [[ "${HTTP_CODE}" == "200" || "${HTTP_CODE}" == "201" ]]; then
  echo "    User created successfully (HTTP ${HTTP_CODE})."
elif [[ "${HTTP_CODE}" == "422" || "${HTTP_CODE}" == "409" ]]; then
  echo "    User already exists (HTTP ${HTTP_CODE}) — continuing (idempotent)."
else
  echo "ERROR: Unexpected response from admin API (HTTP ${HTTP_CODE}):" >&2
  echo "${HTTP_BODY}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: Insert domain fixtures via psql in Docker container
# ---------------------------------------------------------------------------
echo ""
echo "==> Step 3: Inserting dev domain data (workspace + offers + webhook_secrets)"

docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" <<'SQL'
BEGIN;

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
SQL

echo "    Domain data inserted."

# ---------------------------------------------------------------------------
# Step 4: Verification + summary
# ---------------------------------------------------------------------------
echo ""
echo "==> Verification"

WS_COUNT=$(docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000001';" | tr -d ' ')

OFFER_COUNT=$(docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM offers WHERE workspace_id = '00000000-0000-0000-0000-000000000001';" | tr -d ' ')

WH_COUNT=$(docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM webhook_secrets WHERE workspace_id = '00000000-0000-0000-0000-000000000001';" | tr -d ' ')

USER_EXISTS=$(docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM auth.users WHERE id = '00000000-0000-0000-0000-00000000000a';" | tr -d ' ')

echo ""
echo "============================================================"
echo "  FinalTrack — Dev environment ready"
echo "============================================================"
echo "  workspaces    : ${WS_COUNT} (expected: 1)"
echo "  offers        : ${OFFER_COUNT} (expected: 2)"
echo "  webhook_secrets: ${WH_COUNT} (expected: 2)"
echo "  auth.users    : ${USER_EXISTS} dev user (expected: 1)"
echo ""
echo "  Login at : http://127.0.0.1:54323  (Supabase Studio)"
echo "  Email    : ${DEV_EMAIL}"
echo "  Password : ${DEV_PASSWORD}"
echo "============================================================"
