# Fase 2A — Google Ads OAuth + Metadata Sync (Connect & Read Foundation)

> **Status:** spec aprovada (brainstorm 2026-05-07, decisões consolidadas)
> **Escopo:** AGENTS.md §10 Fase 2A — sub-projeto "Connect + Read Foundation"
> **Próximo passo:** plano de implementação (writing-plans)
> **Brainstorm origem:** `docs/handoffs/2026-05-07-fase-2a-brainstorm.md`

---

## 1. Objetivo

Conectar contas Google Ads ao LeoTracker via OAuth e sincronizar metadados (campaigns, ad_groups, ads, asset_groups containers) pra alimentar o dashboard com hierarquia 1‑1‑1 baseada em IDs reais do Google. Sem isso, a Fase 2C (Conversion Upload) não tem `customer_id` autenticado pra mandar `gclid` de volta, e a Fase 2B (Cost Sync) não tem `campaign.id` pra agregar `cost_micros`.

**Critério de sucesso:** Leo clica "Conectar Google Ads" no `/dashboard/integrations`, conclui OAuth, escolhe (se múltiplos) qual customer_id conectar, dispara sync manual, e em <30s vê campaigns/ad_groups/ads (incluindo asset_groups de PMax/DG como containers) na `/dashboard/campaigns`. Cron diário às 03:00 UTC mantém sync sem ação humana. Conta com `refresh_token` revogado mostra badge "⚠ Reconectar" e UI para a próxima ação.

---

## 2. Componentes de alto nível

```
┌─────────────────────────────────────────────────────────────┐
│  App (Next.js)  — UI + route handlers proxy                 │
│                                                             │
│  /dashboard/integrations          — lista + connect/sync/   │
│                                     disconnect              │
│  /dashboard/integrations/select   — múltiplos customer_ids  │
│  /dashboard/campaigns             — lista flat sincronizada │
│                                                             │
│  /api/google-ads/sync             — proxy autenticado       │
│  /api/google-ads/disconnect       — proxy autenticado       │
│  /api/google-ads/finalize         — proxy autenticado       │
│  /api/google-ads/sync-status      — read sync_log (RLS)     │
│  /api/google-ads/select-preview   — proxy /preview          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼ (fetch com Authorization Bearer +
                          │  X-User-JWT)
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  — OAuth + API + Sync                    │
│                                                             │
│  GET  /oauth/google-ads/start                                │
│  GET  /oauth/google-ads/callback                             │
│  GET  /oauth/google-ads/session/:uuid/preview                │
│  POST /oauth/google-ads/finalize                             │
│  POST /api/google-ads/sync                                   │
│  POST /api/google-ads/disconnect                             │
│  scheduled() handler (cron 0 3 * * *)                        │
│                                                             │
│  lib/google-ads/{oauth,client,sync,queries,errors,parsers}  │
│  lib/{internal-auth,structured-log,upsert-bisect,           │
│       customer-id,oauth-error-messages}                     │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼ Postgres REST (service_role; RLS bypass)
┌─────────────────────────────────────────────────────────────┐
│  Supabase Postgres                                          │
│                                                             │
│  google_ads_accounts          (existente)                   │
│  campaigns                    (existente)                   │
│  ad_groups                    (+entity_type, +metadata)     │
│  ads                          (sem mudança na 2A)           │
│  google_ads_sync_log          (renomeada de cost_sync_log;  │
│                                +sync_type, +partial_skipped,│
│                                +trace_id, +parsed_skipped)  │
│  oauth_pending_selections     (NOVA)                        │
│  + RPC mark_removed_for_account()                           │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼ HTTPS
┌─────────────────────────────────────────────────────────────┐
│  Google Ads API v23 (pinada em worker/.../google-ads/constants.ts) │
│  - oauth2.googleapis.com/token                              │
│  - googleads.googleapis.com/v23/customers:listAccessible    │
│  - googleads.googleapis.com/v23/customers/{id}/googleAds:   │
│    search (GAQL)                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Decisões cravadas

> Todas as decisões deste spec foram tomadas no brainstorm de 2026-05-07 (continuação da sessão pausada do mesmo dia). Numerações `Q1-Q10` referem-se às perguntas-chave do brainstorm consolidadas em `docs/handoffs/2026-05-07-fase-2a-brainstorm.md`. Numerações `2.x`, `3.x`, `4.9.x`, `5.7.x`, `6.4.x`, `7.6.x` referem-se às sub-decisões deste segundo bloco do brainstorm (não persistido como handoff próprio — vivem só neste spec).

### 3.1 — Decisões macro (Q1-Q10 do handoff)

Detalhadas em `docs/handoffs/2026-05-07-fase-2a-brainstorm.md` §"Decisões consolidadas pra Fase 2A". Resumo dos pontos que dirigem o spec:

| # | Tema | Decisão |
|---|---|---|
| 1 | Escopo Fase 2 | 3 sub-projetos sequenciais (2A → 2C → 2B) |
| 3 | Developer token | Single-tenant Basic Access; Leo submete formulário durante implementação |
| 4 | OAuth handler | Híbrido — App = UI; Worker = OAuth + API. ENCRYPTION_KEY isolada no Worker |
| 5 | Escopo metadata | campaigns + ad_groups + ads + asset_groups (containers) |
| 6 | Cadência | Manual + cron diário 03:00 UTC |
| 7 | Schema asset_groups | Reuse `ad_groups` com `entity_type` + `metadata JSONB` (β: containers só) |
| 8 | REMOVED entities | Soft delete (status='REMOVED'); UI filtra por padrão; toggle `?include_removed=1` |
| 9 | UI scope | Integrations page + `/dashboard/campaigns` minimal (lista flat sem cost) |
| 10 | Testing | Hybrid — unit/integration mockados em CI + smoke manual antes do merge |

### 3.2 — Decisões deste brainstorm (Seção 2-7 do design)

| ID | Decisão |
|---|---|
| 2.1 | App↔Worker auth: shared secret `WORKER_INTERNAL_TOKEN` (Opção A); App valida ownership via SELECT pré-call; Worker confia no token |
| 2.2 | OAuth state CSRF: cookie HMAC-assinado (`Max-Age=600`, `SameSite=Lax`, `HttpOnly`, `Secure`, path-scoped); sem KV |
| 2.3 | Botões da `/integrations`: 2 componentes — `connect-button.tsx` (CTA de conectar nova conta, no estado vazio e top-right) + `integration-actions.tsx` por linha (consolida Sincronizar + Desconectar com estado de loading mutuamente exclusivo) |
| 3.A.1 | Skip PKCE (Worker é confidential client; state HMAC cobre CSRF). Comment inline em `oauth-google-ads.ts` documentando o porquê |
| 3.A.2 | Múltiplos customer_ids: callback grava state em `oauth_pending_selections` (Postgres com TTL 10min), redireciona pra `/integrations/select`; user escolhe 1+ contas; `/finalize` encrypta+upserta escolhidas |
| 3.A.2.1 | Tabela `oauth_pending_selections`: id, workspace_id (FK), encrypted_payload, payload_iv, created_at, expires_at (DEFAULT NOW() + 10min); RLS `workspace_id IN (workspaces do owner)` |
| 3.A.2.2 | Cleanup de pending expirados: `DELETE … WHERE expires_at < NOW()` no mesmo cron diário (sem job dedicado) |
| 3.A.2.3 | UI de seleção minimal: checkboxes (multi-select), customer_id raw formatado (ver §8.5), countdown live; sem buscar nome amigável (1 API call por customer = quota) |
| 3.A.2.4 | **Pattern App→Worker** (reusável pra 2B/2C): headers `Authorization: Bearer ${WORKER_INTERNAL_TOKEN}` (primary auth, compare timing-safe) + `X-User-JWT: ${supabase_jwt}` (apenas **decodado, não verificado** — Supabase usa ES256/JWKS, ver §8.1). Worker valida via `lib/internal-auth.ts → validateInternalRequest()` que retorna `{workspaceIds: string[], userId}` ou Response 401/404 |
| 3.A.2.5 | `account_name` default no upsert (callback single + `/finalize` multi): se a Google API retornar nome amigável (raro neste fluxo), usa-o; senão `account_name = 'Conta ' || formatCustomerId(customer_id)` (ex.: `Conta 111-111-1111`). Zero overhead, sempre útil pra UI. Substitui fallback genérico `'Conta Google Ads'`. Aplica em `oauth-google-ads.ts` Task 32 (callback) e Task 34 (finalize) |
| 3.A.3 | `manager_customer_id` NULL na 2A; comment inline documenta que valor preenchido vira header `login-customer-id` quando cliente terceiro for conectado |
| 3.B.4 | Concorrência cron+manual: passo 0 do `syncAccount` faz UPDATE zombie cleanup (`WHERE started_at < NOW() - INTERVAL '5 minutes' AND status='running'`). Passo seguinte: 409 se há run `'running'` < 5min |
| 3.B.5.1 | Sem backfill de `google_campaign_id` em `clicks` pré-sync. Tech debt explícito da 2B |
| 3.B.5.2 | `refreshAccessToken` failure handling diferenciado: `invalid_grant` → `is_active=false`; `invalid_client`/`unauthorized_client` → log critical (sem marcar inativo); 5xx → transient retry no próximo cron; unknown 4xx → log + throw. Lib `refresh-token-error-handler.ts` |
| 3.B.5.3 | β: importa asset_groups (containers em `ad_groups` com `entity_type='ASSET_GROUP'`) **sem** asset_group_assets. `ASSET_GROUP_ASSET_QUERY` fica fora |
| 4.9.1 | `'partial'` é 4º estado válido em `google_ads_sync_log.status`; coluna `partial_skipped JSONB` registra contexto |
| 4.9.2 | Bisect fallback pro upsert: `lib/upsert-bisect.ts` recursivo log₂(N) retries; reusável em 2B/2C |
| 4.9.3 | Time budget dinâmico: `WORKER_BUDGET_MS = 28000`; helper `checkBudget(reason)` chamado em phases caras (antes/durante syncAdGroups, antes/durante syncAds, antes de mark_removed). Throw `TimeBudgetError` aborta com `status='partial'` |
| 4.9.4 | `console.error(JSON.stringify({...}))` estruturado; `lib/structured-log.ts` com `createStructuredLogger(traceId)`; `trace_id UUID` gerado uma vez no entry point + propagado em logs e gravado no `sync_log.trace_id` |
| 5.7.1 | UI mostra customer_id formatado (`123-456-7890`); logs estruturados usam raw (grep-friendly); `lib/customer-id.ts` com `formatCustomerId` + `parseCustomerId` |
| 5.7.2 | Polling adaptativo client-side: cadência `1s,1s,2s,2s,3s,3s,5s cap`, timeout 60s. Endpoint `GET /api/google-ads/sync-status?account_id=…` (route handler App, RLS aplica). useEffect cleanup obrigatório. Realtime do Supabase EXISTE no free tier — escolha de polling é por simplicidade pra ação manual single-row, NÃO por limitação |
| 5.7.3 | `/dashboard/campaigns` empty state: CTA direto `[Conectar Google Ads]` (link pro Worker `/oauth/start`); sem hop pra `/integrations` |
| 5.7.4 | Confirmação destrutiva = shadcn AlertDialog (NUNCA `confirm()` nativo). `lib/components/confirm-destructive.tsx` encapsula pattern |
| 6.4.1 | `payload_iv` separado de `encrypted_payload` (pattern existente em `google_ads_accounts.refresh_token_encrypted` + `refresh_token_iv`) |
| 6.4.2 | `sync_type DEFAULT 'cost'` preserva semântica de rows legadas; Worker da 2A INSERT obrigatoriamente passa `sync_type='metadata'` explícito (TS enforcement via helper `insertSyncLog()`) |
| 6.4.3 | `parsed_skipped INTEGER DEFAULT 0` (sinal de drift de schema do Google) |
| 6.4.4 | `trace_id UUID` no `sync_log` permite JOIN log JSON ↔ row |
| 6.4.5 | RPC SQL `mark_removed_for_account(account_id, started_at)` retorna `(campaigns_marked, ad_groups_marked, ads_marked)`; idempotente (`AND status != 'REMOVED'`); 5 cenários cobertos por integration test |
| 7.6.1 | Mocking unit tests = `vi.spyOn(globalThis, 'fetch')` manual (sem msw); pattern documentado em `worker/tests/README.md` |
| 7.6.2 | Smoke 100% manual; runbook formato Fase 1 (pré-condições + ação + validação + pausa) em `docs/runbooks/fase-2a-smoke.md` |
| 7.6.3 | Smoke isolado via `describe.skipIf(!process.env.RUN_SMOKE)`; pre-check `requireSmokeEnv()` falha clara se env vars faltando |
| 7.6.4 | Sequência de implementação: foundation → libs leaf → libs top → UI stub + AlertDialog → Worker routes → conectar UI ao Worker → smoke. UI antes das routes (polling adaptativo é tortuoso de testar sem React useEffect) |
| 7.6.5 | Sem threshold de coverage. Coverage report disponível via `pnpm test --coverage` pra introspeção; NÃO bloqueia merge |

### 3.3 — Verificações pre-spec (V1, V2)

- **V1 (`last_synced_at` em campaigns/ad_groups/ads):** ✓ confirmado em `initial.sql` linhas 41/63/81/102. Migration 004 NÃO precisa adicionar.
- **V2 (UUID generation):** ✓ `uuid-ossp` extension declarada (linha 10); todas as 13 tabelas existentes usam `uuid_generate_v4()`. Migration 004 mantém o mesmo pattern.

---

## 4. Schema final — Migration 004

> **Filename:** `supabase/migrations/20260507000004_google_ads_metadata_sync.sql`

```sql
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
--   de asset_groups (final_urls, channel) sem ALTER TABLE futuro. Schema
--   forward-compat pra 2D.

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
```

**Schema NÃO afetado pela 2A** (mantém estado atual): `conversions`, `conversion_uploads`, `clicks`, `video_events`, `cost_data`, `offers`, `webhook_secrets`, `workspaces`, `google_ads_accounts` (já tem `is_active`, `refresh_token_encrypted`, `refresh_token_iv`, `last_synced_at`, `manager_customer_id`).

---

## 5. Endpoints Worker

Auth pattern (decisão 3.A.2.4) marcado como **`INT`** (internal — Bearer + X-User-JWT) ou **`PUB`** (public — só state cookie/CSRF) ou **`CRON`** (scheduled handler, sem HTTP).

| Path | Method | Auth | Body / Query | Response (success) | Errors |
|---|---|---|---|---|---|
| `/oauth/google-ads/start` | GET | PUB (sessão Supabase via cookie do App; `workspace_id` em query) | `?workspace_id=UUID` | 302 → Google consent + Set-Cookie `lt_oauth_state` | 400 missing workspace; 403 sessão inválida |
| `/oauth/google-ads/callback` | GET | PUB (state cookie) | `?code=…&state=…` ou `?error=…` | 302 → App: `?status=connected` (1 customer) ou `/integrations/select?session=UUID` (2+) | 302 com `?status=oauth_error&reason=…` (state_invalid, state_missing, state_mismatch, code_exchange_failed, no_accounts, db_error, user_cancelled) |
| `/oauth/google-ads/session/:uuid/preview` | GET | INT | path: `:uuid` | 200 `{session_id, customer_ids[], expires_at}` | 401 token/JWT inválido; 404 session inválida ou workspace mismatch; 410 expirada |
| `/oauth/google-ads/finalize` | POST | INT | `{session_uuid, customer_ids: string[]}` | 200 `{accounts_created: N}` | 401; 404; 410; 400 customer_ids vazio |
| `/api/google-ads/sync` | POST | INT | `{google_ads_account_id}` | 200 `{log_id, status: 'running', started_at}` retornado **imediatamente**; sync continua em background via `ctx.waitUntil(syncAccount(...))`. UI faz polling em `/api/google-ads/sync-status?account_id=…` (cadência §9) | 401; 404 account inacessível; 409 sync em andamento (zombie cleanup já tentou) |
| `/api/google-ads/disconnect` | POST | INT | `{google_ads_account_id}` | 200 `{is_active: false}` | 401; 404 |
| `scheduled()` (cron 0 3 * * *) | — | CRON | — | itera `google_ads_accounts WHERE is_active=true`, chama `syncAccount` sequencial; depois `DELETE FROM oauth_pending_selections WHERE expires_at < NOW()` | erros logados via `structured-log`; uma falha não bloqueia próximas accounts |

**Headers comuns INT:**
```
Authorization: Bearer ${WORKER_INTERNAL_TOKEN}
X-User-JWT: ${supabase_session_jwt}
```

**Worker-side validation (`validateInternalRequest`):**
1. `timingSafeEqual` do bearer vs `WORKER_INTERNAL_TOKEN` → 401 se diferente. **Esta é a primary auth do canal App→Worker.**
2. **Decode (sem verify) do `X-User-JWT`** + claims validation (`sub`, `exp`) → 401 se malformado / sem claims / expirado. Não verifica assinatura: Supabase moderno assina o access_token com ES256 (chave assimétrica via JWKS), não HS256 + shared secret. O JWT verify seria defense-in-depth, não primary defense; App→Worker é canal confidencial entre serviços controlados. **Tech debt pre-prod:** migrar pra verificação JWKS real (lib `jose` + cache do endpoint JWKS) — ver `docs/plans/phase-1-status.md`.
3. Extrai `user_id` (`sub`) do JWT, busca workspaces do user via `SELECT id FROM workspaces WHERE owner_id = $user_id` (lista — schema atual permite N workspaces por owner). `workspaces.owner_id` tem FK pra `auth.users`, então uma linha aqui já implica que o user existe. **Lista vazia → 401** (`jwt_error: no_workspace`).
4. Retorna `{workspaceIds: string[], userId}`. Caller usa pra validação cruzada: SELECT da row alvo (account ou pending) e check `row.workspace_id IN workspaceIds`. Mismatch → 404 (não 403 — não vaza existência).
5. Caso atual single-workspace por user, `workspaceIds.length === 1`. Lookup defensivo cobre futuro multi-workspace sem refactor.

**Workspace ownership cruzado (CRÍTICO — service_role bypassa RLS):**
Cada endpoint que recebe `google_ads_account_id` ou `session_uuid` no body/path faz SELECT prévio e checa `row.workspace_id IN workspaceIds` (do `validateInternalRequest`). Mismatch → 404 (não 403 — não vaza existência).

**Env vars novos:**
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_OAUTH_REDIRECT_URI`
- `WORKER_INTERNAL_TOKEN`

`ENCRYPTION_KEY` reusa o secret existente do Worker. (`SUPABASE_JWT_SECRET` foi removido — o `X-User-JWT` é só decodado, não verificado; ver §8.1.)

---

## 6. App routes & páginas

### 6.1 — `/dashboard/integrations`

Server component lista `google_ads_accounts` do workspace. Query params disparam toasts (mapping em `lib/oauth-error-messages.ts`).

**Estado vazio:** título + texto curto + `[Conectar Google Ads]` → link pro Worker `/oauth/google-ads/start?workspace_id=…`.

**Estado populado (1+ contas):** card por account com:
- Nome (`account_name`) + customer_id formatado (`123-456-7890`)
- Badge: `● Conectada` (is_active=true e último log ∈ {success, partial}), `⚠ Reconectar` (is_active=false), `✗ Erro temporário` (is_active=true, último log=failed)
- "Última sync: há Xh (status · rows · duration_ms)" — click expande detalhes (`error_message`, `partial_skipped` formatado)
- Botões: `[Sincronizar agora]` `[Desconectar]` (consolidados em `integration-actions.tsx`)
- Botão top-right `[+ Conectar outra]`

### 6.2 — `/dashboard/integrations/select?session=UUID`

Página renderizada quando OAuth callback detecta múltiplos customer_ids. Server component faz proxy `GET /oauth/google-ads/session/:uuid/preview` via route handler `/api/google-ads/select-preview` (passa JWT do user); recebe `{customer_ids, expires_at}`.

UI:
- Texto explicativo + checkboxes (multi-select) com customer_ids formatados
- Countdown live (atualiza 1s; redireciona pra `?status=session_expired` ao zerar)
- `[Conectar selecionadas]` (disabled se 0) → POST proxy `/api/google-ads/finalize`
- `[Cancelar]` → redirect `/dashboard/integrations` (Worker não deleta a pending; cron pega)

### 6.3 — `/dashboard/campaigns`

Server component faz SELECT JOIN `campaigns + ad_groups + ads` via Supabase REST (RLS aplicada).

**Filtros:** padrão `status != 'REMOVED'`; toggle `?include_removed=1` mostra REMOVED renderizadas em texto cinza.

**Renderização:** lista flat — 1 row por nó folha. Campaigns com ads: 1 row por ad. PMax/DG (asset_group): 1 row por asset_group, coluna "Ad" = "—".

**Empty state (nenhuma conta):** texto + `[Conectar Google Ads]` direto pro Worker `/oauth/start` (sem hop por `/integrations`).

**Limite:** sem paginação na 2A; alerta inline se > 1000 rows. Sem filtros adicionais (por conta, por tipo); chegam na 2B junto com cost data.

### 6.4 — Layout nav

`app/app/(dashboard)/layout.tsx` ganha 2 entradas:
```diff
  <Link href="/dashboard">Resumo</Link>
  <Link href="/dashboard/conversions">Conversões</Link>
+ <Link href="/dashboard/campaigns">Campanhas</Link>
+ <Link href="/dashboard/integrations">Integrações</Link>
```

### 6.5 — Route handlers proxy

```
app/app/api/google-ads/sync/route.ts            — POST → Worker /api/google-ads/sync
app/app/api/google-ads/disconnect/route.ts      — POST → Worker /api/google-ads/disconnect
app/app/api/google-ads/finalize/route.ts        — POST → Worker /oauth/google-ads/finalize
app/app/api/google-ads/select-preview/route.ts  — GET  → Worker /oauth/google-ads/session/:uuid/preview
app/app/api/google-ads/sync-status/route.ts     — GET  → SELECT direto em google_ads_sync_log via Supabase server client (RLS aplica; sem hop pelo Worker)
```

Cada handler proxy: valida sessão Supabase (`getUser()`), valida ownership do `google_ads_account_id` ou `session_uuid` via SELECT pré-call, faz fetch pro Worker com `Authorization: Bearer ${WORKER_INTERNAL_TOKEN}` + `X-User-JWT: ${jwt}`. `WORKER_INTERNAL_TOKEN` nunca chega ao browser.

---

## 7. Bibliotecas auxiliares

### 7.1 — Worker novas (`worker/src/lib/`)

| Arquivo | Responsabilidade |
|---|---|
| `google-ads/oauth.ts` | `buildConsentUrl`, `exchangeCodeForTokens` |
| `google-ads/client.ts` | `refreshAccessToken`, `googleAdsSearch<T>` (paginação interna), `listAccessibleCustomers` |
| `google-ads/sync.ts` | Orchestrator `syncAccount(env, account)` |
| `google-ads/queries.ts` | Strings GAQL versionadas (CAMPAIGN, AD_GROUP, AD, ASSET_GROUP) |
| `google-ads/parsers.ts` | `parseCampaignRow`, `parseAdGroupRow`, `parseAdRow`, `parseAssetGroupRow` (defensivo, retorna null em row inválido) |
| `google-ads/errors.ts` | Classes: `InvalidGrantError`, `InvalidClientError`, `RateLimitError`, `NetworkError`, `ParseError`, `TimeBudgetError`, `GoogleAdsApiError` |
| `google-ads/refresh-token-error-handler.ts` | Switch case que classifica erro e decide `is_active=false` ou não (ver decisão 3.B.5.2) |
| `google-ads/oauth-state.ts` | `signState(payload, secret)`, `verifyState(stateString, cookieString, secret)` |
| `internal-auth.ts` | `validateInternalRequest(req, env)` → `{workspaceId, userId}` ou throws `Response` |
| `structured-log.ts` | `createStructuredLogger(traceId)` → `{info, warn, error}` |
| `upsert-bisect.ts` | `upsertWithBisect(rows, upsertFn, logSkipped)` |
| `customer-id.ts` | `formatCustomerId(raw)`, `parseCustomerId(formatted)` |
| `oauth-error-messages.ts` | mapping `(status, reason) → string`. Worker grava o `reason` no redirect; App lê e mapeia pra mensagem. Mapeamento duplicado em `app/lib/google-ads/oauth-error-messages.ts` na 2A (ver tech debt §13 sobre monorepo shared) |
| `sync-log.ts` | Helper `insertSyncLog(sb, fields)` — força `sync_type` como required parameter (TS) |

### 7.2 — Worker mudança (`worker/src/lib/supabase.ts`)

Adicionar método `update(table, query, patch)` ao `SupabaseClient` (hoje só tem `select`/`insert`/`delete`). Usado em zombie cleanup, mark `is_active=false`, etc.

Adicionar também `rpc<T>(name, params)` pra chamar `mark_removed_for_account`.

### 7.3 — Worker wiring

- `worker/src/index.ts` registra 7 routes novas (4 OAuth + 2 API + status handler do scheduled).
- `worker/wrangler.toml` ganha:
  ```toml
  [triggers]
  crons = ["0 3 * * *"]
  ```

### 7.4 — App novas (`app/lib/`)

| Arquivo | Responsabilidade |
|---|---|
| `lib/components/confirm-destructive.tsx` | Wrapper shadcn AlertDialog `{trigger, title, description, actionLabel, onConfirm}` |
| `lib/google-ads/customer-id.ts` | re-export de `formatCustomerId`/`parseCustomerId` (cópia ou monorepo shared — decidir no plan) |
| `lib/google-ads/oauth-error-messages.ts` | idem |
| `lib/google-ads/sync-polling.ts` | `useSyncStatus(accountId)` hook — useEffect setInterval com cadência adaptativa, cleanup garantido |

### 7.5 — App setup adicional

- `pnpm dlx shadcn@latest add alert-dialog` antes de `confirm-destructive.tsx`.

---

## 8. Patterns transversais

### 8.1 — Internal auth (decisão 3.A.2.4)

Todo endpoint Worker chamado pelo App passa por `validateInternalRequest`. Cron e callbacks públicos (start/callback OAuth) não passam.

**Primary auth = `WORKER_INTERNAL_TOKEN`** (compare timing-safe). O `X-User-JWT` (Supabase access_token) é só **decodado, não verificado** — Supabase moderno usa ES256/JWKS, não HS256 + shared secret. Decisão original (3.A.2.4) assumiu HS256; corrigido para decode-without-verify (Opção C) após bug em runtime. Tech debt pre-prod: migrar pra JWKS verification real. Ver `worker/src/lib/internal-auth.ts` (comentário) e `docs/plans/phase-1-status.md`.

### 8.2 — Structured logging (decisão 4.9.4)

**Contrato cravado pra todo log emitido pelo Worker em código da 2A:**

```jsonc
{
  "level": "info" | "warn" | "error",
  "event": "<snake_case_event_name>",   // obrigatório, namespace por fase
  "trace_id": "<uuid>",                 // obrigatório, mesmo trace_id do sync_log row
  "elapsed_ms": <number>,               // obrigatório, ms desde início do request
  "...campos específicos do event"
}
```

Lib `worker/src/lib/structured-log.ts` exporta:
```ts
createStructuredLogger(traceId: string, startedAt: number) → {
  info(event: string, fields?: Record<string, unknown>): void,
  warn(event: string, fields?: Record<string, unknown>): void,
  error(event: string, fields?: Record<string, unknown>): void,
}
```

`elapsed_ms` é injetado pelo logger (não passado pelo caller). `level` e `trace_id` idem. Cada chamada vira `console.error(JSON.stringify({level, event, trace_id, elapsed_ms, ...fields}))`.

Uso típico:
```ts
const traceId = crypto.randomUUID();
const log = createStructuredLogger(traceId, Date.now());
const logId = await insertSyncLog(sb, { sync_type: 'metadata', trace_id: traceId, ... });

log.info('phase_started', { phase: 'campaigns', account_id });
log.warn('upsert_row_skipped', { table: 'campaigns', row_id: '...' });
log.error('sync_failed', { reason: 'rate_limited', retry_attempt: 3 });
```

**Nenhum `console.log` ou `console.error` direto no código de sync.** Tudo passa pelo logger pra garantir schema. Lint rule (futura) pode enforçar.

### 8.3 — Bisect upsert (decisão 4.9.2)

```ts
const result = await upsertWithBisect(
  campaignRows,
  (batch) => sb.upsert('campaigns', batch, { onConflict: 'google_ads_account_id,google_campaign_id' }),
  (skipped) => log.warn('upsert_row_skipped', { table: 'campaigns', row_id: skipped.google_campaign_id })
);
parsed_skipped += result.skipped;
```

### 8.4 — Time budget (decisão 4.9.3)

```ts
const WORKER_BUDGET_MS = 28000; // 28s; deixa 2s pra log final + cleanup
const startedAt = Date.now();

function checkBudget(reason: string) {
  if (Date.now() - startedAt > WORKER_BUDGET_MS) {
    throw new TimeBudgetError(reason, Date.now() - startedAt);
  }
}
```

**Pontos de check obrigatórios** (sem isso, sync com >500 ads ultrapassa budget e Worker morre silenciosamente sem registrar `partial_skipped`):

| Phase | Quando chamar `checkBudget(reason)` |
|---|---|
| Após `syncCampaigns` completar | `checkBudget('before_ad_groups')` antes de iniciar a phase de ad_groups |
| Durante `syncAdGroups` | `checkBudget('mid_ad_groups')` a cada **10** ad_groups processados |
| Após `syncAdGroups` completar | `checkBudget('before_ads')` antes de iniciar a phase de ads |
| Durante `syncAds` | `checkBudget('mid_ads')` a cada **50** ads processados |
| Antes de `mark_removed_for_account` | `checkBudget('before_mark_removed')` |

`TimeBudgetError` é capturada pelo `syncAccount`, transição pra `status='partial'`, `partial_skipped` JSONB registra `{reason, elapsed_ms, phase_completed: 'campaigns'|'ad_groups'|'ads', skipped: [...]}`. Próxima cron retenta sync inteiro.

### 8.5 — Customer ID format (decisão 5.7.1)

`worker/src/lib/customer-id.ts` (com cópia em `app/lib/google-ads/customer-id.ts` na 2A):

```ts
formatCustomerId(raw: string): string  // "1234567890" → "123-456-7890"
parseCustomerId(formatted: string): string  // "123-456-7890" → "1234567890"
```

Regras:
- **UI**: sempre formatado. Toda renderização de customer_id na `/dashboard/integrations`, `/dashboard/integrations/select`, `/dashboard/campaigns`, toasts, AlertDialog descriptions passa por `formatCustomerId`.
- **Logs estruturados**: sempre raw (10 dígitos). Grep-friendly em `wrangler tail` e em sync_log JOIN.
- **Persistência DB**: sempre raw (`google_ads_accounts.customer_id` TEXT, formato `1234567890`).
- **`parseCustomerId`**: usado em forms futuros de busca/edição (input do user pode ser formatado ou raw — `parseCustomerId` normaliza). Não tem use case na 2A, mas implementado + testado já pra evitar inconsistência depois.
- Format inválido → `parseCustomerId` throw `Error('invalid_customer_id_format')`.

Sem exceção a essas regras.

### 8.6 — Confirm destructive (decisão 5.7.4)

Toda confirmação destrutiva passa por `<ConfirmDestructive>` (wrapper shadcn AlertDialog). `window.confirm()` proibido por convenção do projeto.

---

## 9. Polling, cadências e TTLs

| Coisa | Valor | Origem |
|---|---|---|
| Polling sync status (UI) | 1s, 1s, 2s, 2s, 3s, 3s, 5s (cap), timeout 60s | 5.7.2 |
| Cron metadata sync + cleanup | `0 3 * * *` (UTC) | Q6 / 3.A.2.2 |
| OAuth state cookie TTL | 600s | 2.2 |
| `oauth_pending_selections` TTL | 10min (DB DEFAULT) | 3.A.2.1 |
| Zombie sync_log timeout | 5min | 3.B.4 |
| Worker time budget interno | 28s (deixa 2s pra log/cleanup) | 4.9.3 |
| GAQL pageSize | 1000 | 3.B.3 |
| Sync concorrência interna (campaigns) | batches de 5 paralelos | 3.B.3 |
| `googleAdsSearch` retries | 3x exponential 1→2→4s, respeita Retry-After | 4.1 |
| `fetchWithRetry` network | 2 retries 1→3s, AbortController 8s/req | 4.2 |

---

## 10. Sequência de implementação (decisão 7.6.4)

> Spec lista a ordem; writing-plans expande em tasks com dependências.

1. **Migration 004 + RPC tests** (foundation; toda task que toca DB depende)
   ▸ **Checkpoint após:** Leo + Claude validam schema com SELECTs (campos novos presentes, RLS ativa, RPC executável). Pausa pra ajustes antes de seguir.
2. **Libs leaf (parte A):** `customer-id`, `structured-log`, `internal-auth`, helpers de crypto
3. **Libs leaf (parte B):** `parsers`, `upsert-bisect`, `oauth.ts` (sign/verify state, build URLs)
4. **Libs top:** `client.ts` (refresh + search + paginação), `sync.ts` (orchestrator)
   ▸ **Checkpoint após:** unit tests + integration tests verdes (`pnpm test`). Pausa pra revisar coverage qualitativa de cenários (não threshold).
5. **App UI básica + AlertDialog setup (modo stub):** páginas `/integrations`, `/integrations/select`, `/campaigns` renderizam dados mockados; route handlers stub retornam JSON estático; `confirm-destructive.tsx` pronto
   ▸ **Checkpoint após:** Leo + Claude validam flow visual com mocks no browser (`pnpm dev`). Confirma layout, AlertDialog, polling cadence visualmente. Pausa pra ajustes UX antes de conectar Worker.
6. **Worker routes:** OAuth (start/callback/preview/finalize), sync, disconnect, scheduled handler
7. **Conectar UI real:** route handlers do App passam a chamar Worker; remove mocks; polling adaptativo conectado em `useSyncStatus`
   ▸ **Checkpoint após:** smoke manual completo (runbook §11.3 — todos 9 passos verde). Pausa antes do merge final pra Leo aprovar.
8. **Smoke manual** (runbook em `docs/runbooks/fase-2a-smoke.md`) antes do merge

Pattern de pausas explícitas validou nas Fase 1 + Payt (12/12 smoke verde). Aplica idêntico aqui.

---

## 11. Testing

### 11.1 — Pirâmide

- **Unit tests** (Vitest, fetch mockado): maioria da cobertura. Pattern `vi.spyOn(globalThis, 'fetch')` documentado em `worker/tests/README.md`.
- **Integration tests** (Vitest + Supabase local Docker): toca schema real, não toca Google API. Cobre RPC, upsert real, sync_log JSONB roundtrip.
- **Smoke manual** (runbook): roda Worker real contra Google Ads test customer; pré-merge.

### 11.2 — Tabela de tests

**Unit (`worker/tests/google-ads/`):**

| Arquivo | Cenários |
|---|---|
| `oauth.test.ts` | buildConsentUrl, exchangeCodeForTokens (200 + 400 invalid_grant), state HMAC sign/verify (válido, exp expirado, sig mismatch, missing) |
| `client.test.ts` | refreshAccessToken (success + invalid_grant + invalid_client + 5xx); googleAdsSearch (single/multi page + 429+Retry-After + network error + 401 expired) |
| `parsers.test.ts` | parseCampaign/AdGroup/Ad/AssetGroup happy + missing required + wrong type → null |
| `sync.test.ts` | full success; time budget exceeded; rate limit aborta; partial sync; REMOVED detection |

**Unit (`worker/tests/lib/`):**

| Arquivo | Cenários |
|---|---|
| `upsert-bisect.test.ts` | empty, all ok, single fail, half fail, recursão log₂ |
| `structured-log.test.ts` | trace_id propagation, JSON output |
| `internal-auth.test.ts` | token+JWT válidos/inválidos/missing/workspace mismatch → 404 |
| `customer-id.test.ts` | format/parse roundtrip, formato inválido → throw |

**Integration (`worker/tests/google-ads/` contra Supabase local):**

| Arquivo | Cenários |
|---|---|
| `mark-removed.test.ts` | 5 cenários da decisão 6.4.5 |
| `upsert.test.ts` | UNIQUE constraints, merge-duplicates, batch |
| `oauth-pending.test.ts` | INSERT/SELECT/DELETE, expires_at filter, encrypt+decrypt roundtrip |
| `sync-log.test.ts` | INSERT com sync_type='metadata', UPDATE para success/partial/failed, partial_skipped JSONB |

### 11.3 — Smoke runbook

`docs/runbooks/fase-2a-smoke.md` — formato Fase 1 (pré-condições + ação + validação SQL/log + pausa). 9 passos:

1. Connect happy path (1 customer)
2. Connect com múltiplos customer_ids → seleção
3. Sync manual via UI → polling → status final
4. REMOVED detection (criar/remover campaign no GA, sync, verificar)
5. Disconnect via UI (AlertDialog)
6. Reconnect (is_active volta TRUE)
7. Cron diário (`wrangler dev --test-scheduled`)
8. invalid_grant simulation (revoke consent na conta Google)
9. Selection session expirado (espera 11min)

### 11.4 — Fixtures

`worker/tests/fixtures/google-ads/` — payloads sanitizados (customer_ids → `1234567890`, IDs → sequenciais 100/101/...). README com processo de captura. Lista mínima:

```
oauth-tokens-response.json          — exchangeCodeForTokens success
oauth-error-invalid-grant.json      — refreshAccessToken 400
oauth-error-invalid-client.json     — refresh 401
customers-list-single.json          — listAccessibleCustomers 1 customer
customers-list-multi.json           — listAccessibleCustomers 3 customers
campaigns-search-single-page.json   — googleAds:search 5 rows, sem nextPageToken
campaigns-search-multi-page-1.json  — page 1 com nextPageToken
campaigns-search-multi-page-2.json  — page 2 final
ad-groups-search-response.json      — query AD_GROUP_QUERY
ads-search-response.json            — query AD_QUERY
asset-groups-search-response.json   — query ASSET_GROUP_QUERY (PMax+DG)
error-rate-limit.json               — 429 + Retry-After: 5
error-quota-exhausted.json          — RESOURCE_EXHAUSTED body
error-malformed-response.json       — payload sem campo .results
```

### 11.5 — CI / smoke isolation

- `pnpm test` (CI default): unit + integration. Smoke skipados via `describe.skipIf(!process.env.RUN_SMOKE)`.
- `pnpm test:smoke` (manual): roda smoke; helper `requireSmokeEnv()` em `beforeAll` falha clara se faltar `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_TEST_CUSTOMER_ID`, `GOOGLE_ADS_OAUTH_CLIENT_ID`, `GOOGLE_ADS_OAUTH_CLIENT_SECRET`.
- **Sem threshold de coverage.** Coverage report disponível via `pnpm test --coverage` pra introspeção; NÃO bloqueia merge.

---

## 12. Out-of-scope explícito

### 12.1 — Distinção crítica: multi-account ≠ multi-tenant SaaS

**2A é single-tenant.** "Multi-account" neste spec refere-se ao Leo conectando múltiplas contas Google Ads próprias (pessoal + parceiros que ele opera) sob a mesma `workspace`. NÃO refere-se a múltiplos clientes do LeoTracker como produto SaaS.

Implicações:
- Developer token submetido como Basic Access single-tenant (decisão Q3 do handoff).
- `oauth_pending_selections` pattern de multi-customer existe pra selecionar qual conta própria conectar, não pra múltiplos tenants.
- RLS atual (`workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())`) presume 1 owner por workspace.

**Se o produto virar SaaS comercial multi-tenant**, são pré-requisitos antes de aceitar usuários terceiros:
1. Re-submissão do developer token como **third-party** access (workflow Google diferente, ~3-5 dias review).
2. Revisão de schema `workspaces` (multi-owner? multi-member roles?).
3. Revisão de RLS em todas as tabelas (`workspace_id` pode precisar `member_id` JOIN).
4. Implementar header `login-customer-id` quando `manager_customer_id` está populado (já preparado no schema, ver decisão 3.A.3).
5. Revisão do pattern de auth interno (`WORKER_INTERNAL_TOKEN` é shared secret single-deploy; multi-tenant pode exigir per-tenant tokens).

Sem isso, "multi-account OAuth" pode ser mal-interpretado como "multi-tenant SaaS" e introduzir bugs silenciosos de RLS.

### 12.2 — Tabela de exclusões

| Tema | Onde fica |
|---|---|
| Asset_group_assets (creatives individuais de PMax/DG: videos, images, headlines) | **Fase 2D** (asset-level data) |
| Conversion actions sync (`google_conversion_actions` table) | **Fase 2C** (conversion upload) |
| Conversion upload (Offline Conversion Import + Enhanced Conversions + adjustments) | **Fase 2C** |
| Cost data sync diário + dashboard ROAS/CPA | **Fase 2B** |
| Multi-tenant SaaS (vários clientes do LeoTracker) | Pré-requisitos em §12.1 |
| Backfill de `clicks.google_campaign_id` pré-sync | **Tech debt 2B** (ver §13) |
| Smoke automation (script auxiliar Node) | Tech debt fase futura quando smoke virar regression |
| Renomear contas (account label/nickname) | UX follow-up pós-2A |
| Filtros adicionais em `/dashboard/campaigns` (por conta, por tipo) | Fase 2B (justifica quando cost data entra) |
| Paginação em `/dashboard/campaigns` | Fase futura quando > 1000 rows for caso real |
| Realtime via Supabase websocket | Não — polling é escolha intencional pra single-row manual action |
| Sentry / Axiom / observability stack externa | Fase própria de observability |

---

## 13. Tech debts conhecidos

| Item | Sintoma esperado | Plano |
|---|---|---|
| Sync >30s não cabe no Worker | Account com >200 campaigns ou >500 ads atinge `TimeBudgetError`; sync_log fica `partial`; phases pendentes nunca executam até split | Cloudflare Queues ou Durable Objects ou splitting por entidade. Documentar quando aparecer; profile primeiro |
| Backfill `clicks.google_campaign_id` pré-sync | Clicks anteriores ao primeiro sync mostram "Não atribuído" no dashboard | UPDATE manual via SQL na 2B (trivial: UPDATE clicks SET google_campaign_id = … FROM campaigns WHERE clicks.gad_campaignid = campaigns.google_campaign_id) |
| Refresh access_token cache ausente | Cada syncAccount chama refreshAccessToken; cron com N accounts gasta N refreshes | Sem ação na 2A (single-tenant ~1-3 accounts). Quando virar problema: cache em-memória do Worker request scope ou KV |
| Multi-tenant rate limit prevention | Se virar SaaS, 1 developer token compartilhado pode estourar quota Google | Tech debt da 2A→multitenant |
| Smoke regression automation | Cada release nova precisa rodar 9 passos manuais | Script automatizado quando smoke virar regression test (não na 2A) |
| `oauth-error-messages.ts` duplicado App + Worker | Manter mensagens em sync entre packages | Considerar monorepo shared package (`packages/shared`) se duplicação crescer |
| PMax/DG sem creative-level data | `/dashboard/campaigns` mostra asset_groups como "—" na coluna Ad | Resolvido na Fase 2D |
| `mark_removed_for_account` RPC usa `IN (SELECT)` em ad_groups + ads | Postgres 12+ otimiza bem em volume baixo; em volume alto (>10K ads) plano pode degradar pra nested loop | Profile primeiro (`EXPLAIN ANALYZE`); se necessário, refatorar pra `WITH` CTE encadeada. Tech debt até medirmos |
| **Versão da Google Ads API pinada** (`worker/src/lib/google-ads/constants.ts` → `GOOGLE_ADS_API_VERSION = 'v23'`) | Google moveu pra release cadence mensal em 2026. v17-v19 já sunsetted; v20 sunset Jun/2026; v21 ~Jul-Aug/2026; v22 ~Sep-Oct/2026; v23 ~Jan-Feb/2027. Chamada à API de versão sunsetted retorna **404** (foi exatamente o que quebrou o callback no smoke de 2026-05-12) | **Rotina de manutenção: revisar a versão a cada ~6 meses** (antes de Fase 5/operacional vira marco fixo). Upgrade = mudar a constante + rodar `pnpm worker:test` + smoke OAuth. Google recomenda pular versões intermediárias (upgrade direto pra current stable). Validar GAQL schemas + parsers a cada bump major |

---

## 14. Referências

- Handoff origem: `docs/handoffs/2026-05-07-fase-2a-brainstorm.md`
- AGENTS.md §10 (Fase 2): contexto Google Ads
- `app/AGENTS.md`: Next.js breaking changes — consultar `node_modules/next/dist/docs/` antes de escrever código UI
- Spec Fase 1: `docs/specs/phase-1-click-capture.md` (template de estilo)
- Smoke Fase 1: `docs/specs/phase-1-smoke-test.md` (formato runbook a seguir na 2A)
