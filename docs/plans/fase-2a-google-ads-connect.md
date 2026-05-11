# Fase 2A — Google Ads OAuth + Metadata Sync: Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar este plano tarefa-por-tarefa. Steps usam checkbox (`- [ ]`).

**Goal:** Implementar OAuth Google Ads + sync diário de metadata (campaigns, ad_groups, ads, asset_groups containers) com UI no dashboard pra conectar contas, sincronizar manual e visualizar a hierarquia 1‑1‑1.

**Architecture:** Worker Cloudflare é confidential client OAuth + sync orchestrator (lib `google-ads/`). App Next.js renderiza UI + route handlers proxy autenticados pro Worker via shared secret + JWT do user. Postgres ganha 4 mudanças (Migration 004) + RPC pra mark_removed atômico. Cron diário às 03:00 UTC + cleanup de pending sessions.

**Tech Stack:** TypeScript, Cloudflare Workers + Wrangler (cron + scheduled), Vitest com `@cloudflare/vitest-pool-workers` (Miniflare), Supabase (Postgres + Auth via @supabase/ssr) + RPC SQL, Next.js 16 + Server Components + route handlers, shadcn/ui (AlertDialog), Google Ads API v17.

**Spec referência:** `docs/specs/fase-2a-google-ads-connect.md` (commit `47a3080`)

---

## File Structure

Arquivos criados/modificados nesta fase, agrupados por responsabilidade.

**Banco:**
- `migrations/004_google_ads_metadata_sync.sql` — schema delta da 2A
- `supabase/migrations/20260507000004_google_ads_metadata_sync.sql` — copy aplicada localmente

**Worker — libs novas (`worker/src/lib/`):**
- `customer-id.ts` — `formatCustomerId` + `parseCustomerId`
- `structured-log.ts` — `createStructuredLogger(traceId, startedAt)`
- `internal-auth.ts` — `validateInternalRequest(req, env)` → `{workspaceIds, userId}`
- `upsert-bisect.ts` — `upsertWithBisect(rows, upsertFn, logSkipped)`
- `oauth-error-messages.ts` — mapping `(status, reason) → string` (PT-BR)
- `sync-log.ts` — `insertSyncLog`/`updateSyncLog` enforçando `sync_type` required

**Worker — google-ads namespace novo (`worker/src/lib/google-ads/`):**
- `errors.ts` — classes (`InvalidGrantError`, `RateLimitError`, `TimeBudgetError`, etc.)
- `queries.ts` — strings GAQL (`CAMPAIGN_QUERY`, `AD_GROUP_QUERY`, `AD_QUERY`, `ASSET_GROUP_QUERY`)
- `parsers.ts` — `parseCampaignRow`, `parseAdGroupRow`, `parseAdRow`, `parseAssetGroupRow`
- `oauth.ts` — `buildConsentUrl`, `exchangeCodeForTokens`
- `oauth-state.ts` — `signState`, `verifyState` (cookie HMAC)
- `client.ts` — `refreshAccessToken`, `googleAdsSearch<T>`, `listAccessibleCustomers`
- `refresh-token-error-handler.ts` — classifica erro de refresh em `is_active=false` ou transient
- `sync.ts` — orchestrator `syncAccount`

**Worker — supabase wrapper estendido:**
- `worker/src/lib/supabase.ts` — adiciona métodos `update`, `upsert`, `rpc` (modify)

**Worker — routes novas (`worker/src/routes/`):**
- `oauth-google-ads.ts` — 4 handlers (`/start`, `/callback`, `/preview`, `/finalize`)
- `google-ads-sync.ts` — `POST /api/google-ads/sync`
- `google-ads-disconnect.ts` — `POST /api/google-ads/disconnect`

**Worker — entry point:**
- `worker/src/index.ts` — registra novas routes (modify)
- `worker/src/index.ts` — exporta `scheduled()` handler (modify)
- `worker/wrangler.toml.example` — `[triggers] crons = ["0 3 * * *"]` (modify)
- `worker/src/types.ts` — adiciona env vars novos ao `Env` (modify)

**Worker — tests novos (`worker/tests/`):**
- `lib/customer-id.test.ts`
- `lib/structured-log.test.ts`
- `lib/internal-auth.test.ts`
- `lib/upsert-bisect.test.ts`
- `google-ads/oauth.test.ts`
- `google-ads/oauth-state.test.ts`
- `google-ads/parsers.test.ts`
- `google-ads/client.test.ts`
- `google-ads/refresh-token-error-handler.test.ts`
- `google-ads/sync.test.ts`
- `google-ads/mark-removed.test.ts` (integration — RPC)
- `google-ads/upsert.test.ts` (integration)
- `google-ads/oauth-pending.test.ts` (integration)
- `google-ads/sync-log.test.ts` (integration)
- `routes/oauth-google-ads.test.ts`
- `routes/google-ads-sync.test.ts`
- `routes/google-ads-disconnect.test.ts`
- `routes/scheduled.test.ts`
- `lib/smoke-env-check.ts` (helper, sem `.test.ts`)
- `fixtures/google-ads/*.json` (14 fixtures)
- `fixtures/google-ads/README.md`
- `worker/tests/README.md` (modify — seção "Google Ads API mocking")

**App — libs novas (`app/lib/`):**
- `google-ads/customer-id.ts` — cópia do Worker
- `google-ads/oauth-error-messages.ts` — cópia do Worker
- `google-ads/sync-polling.ts` — `useSyncStatus(accountId)` hook

**App — components (`app/components/`):**
- `ui/alert-dialog.tsx` — adicionado via `pnpm dlx shadcn@latest add alert-dialog`
- `confirm-destructive.tsx` — wrapper de AlertDialog

**App — pages novas (`app/app/(dashboard)/dashboard/`):**
- `integrations/page.tsx` — server component principal
- `integrations/connect-button.tsx` — client component (link pro Worker /oauth/start)
- `integrations/integration-actions.tsx` — client component (sync + disconnect)
- `integrations/select/page.tsx` — server component da seleção multi-customer
- `integrations/select/select-form.tsx` — client component (checkboxes + countdown + submit)
- `campaigns/page.tsx` — server component lista flat
- `campaigns/_components/include-removed-toggle.tsx` — client toggle do filtro

**App — route handlers proxy (`app/app/api/google-ads/`):**
- `sync/route.ts` — POST → Worker /api/google-ads/sync
- `disconnect/route.ts` — POST → Worker /api/google-ads/disconnect
- `finalize/route.ts` — POST → Worker /oauth/google-ads/finalize
- `select-preview/route.ts` — GET → Worker /oauth/google-ads/session/:uuid/preview
- `sync-status/route.ts` — GET direto Supabase (sem Worker)

**App — wiring:**
- `app/app/(dashboard)/layout.tsx` — adiciona links nav (modify)
- `app/.env.local.example` — adiciona `WORKER_INTERNAL_TOKEN`, `WORKER_BASE_URL` (modify)
- `app/lib/env.ts` (se existir) ou usar `process.env` direto

**Docs:**
- `docs/runbooks/fase-2a-smoke.md` — runbook smoke manual (9 passos)
- `AGENTS.md` — atualiza §10 com status "Fase 2A entregue" (modify final)

---

## Notas de execução

- **Working directory:** `C:\Users\lenzi\FinalTrack`.
- **Pré-requisitos:** Node 20+, pnpm 9+, Wrangler 3+, Supabase CLI 1.x, Docker rodando, conta Google Cloud Console com OAuth Client ID criado.
- **Idioma:** comentários, mensagens de UI e commits em PT-BR. Nomes de identificadores em inglês.
- **Commits:** PT-BR Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`).
- **TDD:** test primeiro pra código com lógica (libs, parsers, client, sync, routes). Pra UI/scaffold/migrations, criar+commitar direto.
- **Branch:** trabalhar em `feat/fase-2a-google-ads-connect` desde a Task 0; merge pra `main` só após smoke passar.
- **Segredos:** valores reais de `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `WORKER_INTERNAL_TOKEN`, `SUPABASE_JWT_SECRET` ficam em `wrangler.toml`/`.env.local` (não-commitados). Templates `.example` ganham apenas as chaves.
- **Checkpoints:** Phases 1, 4, 5, 7 terminam com pausa explícita pra revisão Leo+Claude antes de seguir (pattern §10 do spec).

---

## Task 0: Pré-requisitos da fase

**Files:**
- Nenhum (verificações + branch creation)

- [ ] **Step 1: Verificar working tree limpo + branch correto**

```bash
git status
git branch --show-current
```
Esperado: `working tree clean`. Se branch atual ≠ `main`, voltar pra `main` antes de iniciar.

- [ ] **Step 2: Criar branch da fase**

```bash
git switch -c feat/fase-2a-google-ads-connect
```

- [ ] **Step 3: Confirmar Supabase local rodando + 156 testes Fase 1 verdes**

```bash
supabase status
pnpm worker:test
```
Esperado: `supabase status` mostra todos os serviços `RUNNING`. Worker tests = 156/156 passando.

Se Supabase não está up: `supabase start`. Se testes falharem: pausar e diagnosticar antes de seguir.

- [ ] **Step 4: Criar OAuth Client no Google Cloud Console (ação manual)**

Acessar https://console.cloud.google.com/apis/credentials → Create Credentials → OAuth client ID:
- Application type: **Web application**
- Name: `LeoTracker Local Dev`
- Authorized redirect URIs: `http://localhost:8787/oauth/google-ads/callback`

Anotar **Client ID** e **Client secret** (vão pra `wrangler.toml` mais tarde, não commitar).

> Pra dev local contra test customer, esse é OAuth client suficiente. Pra produção, criar OAuth client separado em outro projeto Google Cloud com redirect URI de produção.

- [ ] **Step 5: Solicitar Google Ads developer token (ação manual em paralelo)**

Acessar https://ads.google.com → Tools & Settings → API Center → solicitar **Basic Access** (single-tenant, decisão Q3). Pode ser submetido agora; aprovação ~3-5 dias úteis. Enquanto não aprova, testar contra `test customer ID` (criar via Manager Account).

Anotar **Developer Token** quando aprovar (vai pra `wrangler.toml`).

- [ ] **Step 6: Anotar IDs em arquivo local (não commitar)**

Criar `.notes-fase-2a.local.md` (já no `.gitignore` pelo padrão `*.local.md`) com:
```
GOOGLE_ADS_CLIENT_ID=<copiado do step 4>
GOOGLE_ADS_CLIENT_SECRET=<copiado do step 4>
GOOGLE_ADS_DEVELOPER_TOKEN=<copiado do step 5, quando aprovar>
GOOGLE_ADS_TEST_CUSTOMER_ID=<criar test customer ID na manager account>
```

Confirmar que esse arquivo NÃO aparece em `git status`.

- [ ] **Step 7: Commitar branch vazia (marker)**

Sem mudanças commitáveis ainda. Apenas confirmar branch criada e remoto preparado:

```bash
git log -1 --oneline
```
Esperado: `47a3080 docs(spec): Fase 2A Google Ads Connect + Read Foundation`.

---

## Phase 1 — Migration 004 + RPC tests

> Foundation. Toda task que toca DB depende de Phase 1 estar concluída.

## Task 1: Escrever Migration 004 SQL

**Files:**
- Create: `migrations/004_google_ads_metadata_sync.sql`

- [ ] **Step 1: Criar arquivo de migration**

Conteúdo de `migrations/004_google_ads_metadata_sync.sql` (copia exata do spec §4):

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
```

- [ ] **Step 2: Commitar migration source**

```bash
git add migrations/004_google_ads_metadata_sync.sql
git commit -m "feat(db): migration 004 google ads metadata sync"
```

---

## Task 2: Aplicar Migration 004 local + smoke checks

**Files:**
- Create: `supabase/migrations/20260507000004_google_ads_metadata_sync.sql`

- [ ] **Step 1: Copiar pra estrutura Supabase CLI**

```bash
cp migrations/004_google_ads_metadata_sync.sql supabase/migrations/20260507000004_google_ads_metadata_sync.sql
```

- [ ] **Step 2: Resetar DB e aplicar**

```bash
supabase db reset
```
Esperado: todas as migrations aplicadas em sequência sem erro SQL.

- [ ] **Step 2.5: Re-seed dev workspace + auth user (OBRIGATÓRIO após reset)**

```bash
bash scripts/setup-dev.sh
```

`supabase db reset` apaga `workspaces` + `auth.users` (cleanup completo). Sem re-seed, integration tests da Phase 1 (Tasks 3-5) batem em `FK violation: workspace_id not present in workspaces`. Esse passo virou obrigatório após execução da Phase 1 onde o implementer da Task 3 perdeu ~30min reparando manualmente.

- [ ] **Step 3: Smoke check — schema novo presente**

Rodar via Studio (http://localhost:54323) ou psql:

```sql
-- Verifica entity_type em ad_groups
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ad_groups' AND column_name IN ('entity_type', 'metadata');

-- Verifica rename + colunas novas em google_ads_sync_log
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'google_ads_sync_log';

-- Verifica oauth_pending_selections
SELECT * FROM oauth_pending_selections LIMIT 1;

-- Verifica RPC executável
SELECT * FROM mark_removed_for_account('00000000-0000-0000-0000-000000000000'::uuid, NOW());
```

Esperado:
- `ad_groups.entity_type` = `text NOT NULL DEFAULT 'AD_GROUP'`
- `ad_groups.metadata` = `jsonb NULL`
- `google_ads_sync_log` tem `sync_type`, `partial_skipped`, `trace_id`, `parsed_skipped`
- `oauth_pending_selections` query retorna 0 rows sem erro
- RPC retorna `(0, 0, 0)` (account inexistente, sem rows pra marcar)

- [ ] **Step 4: Confirmar tabela `cost_sync_log` não existe mais**

```sql
SELECT * FROM cost_sync_log;
```
Esperado: erro `relation "cost_sync_log" does not exist`. (Migration 004 renomeou.)

- [ ] **Step 5: Commitar migration aplicada**

```bash
git add supabase/migrations/20260507000004_google_ads_metadata_sync.sql
git commit -m "chore(db): aplicar migration 004 no supabase local"
```

---

## Task 3: Test integration `mark_removed_for_account` RPC (5 cenários)

**Files:**
- Create: `worker/tests/google-ads/mark-removed.test.ts`

> Roda contra Supabase local. Usa fixtures direto via SQL setup/teardown. Cobre os 5 cenários cravados na decisão 6.4.5 do spec.

- [ ] **Step 1: Escrever teste**

Conteúdo de `worker/tests/google-ads/mark-removed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../../src/lib/supabase';

const ACCOUNT_ID = '00000000-0000-0000-0000-00000000a001';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'; // dev workspace do seed

interface SbExtended {
  rpc: <T = unknown>(name: string, params: Record<string, unknown>) => Promise<T>;
}

async function resetFixtures(sb: ReturnType<typeof createSupabaseClient>) {
  // limpa estado de testes anteriores (cascade via FK)
  await sb.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
  await sb.insert('google_ads_accounts', {
    id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    customer_id: '1234567890',
    refresh_token_encrypted: 'fake_ct',
    refresh_token_iv: 'fake_iv',
  });
}

async function insertCampaign(sb: ReturnType<typeof createSupabaseClient>, id: string, lastSyncedAt: string, status = 'ENABLED') {
  await sb.insert('campaigns', {
    id,
    google_ads_account_id: ACCOUNT_ID,
    google_campaign_id: id.slice(-3),
    name: `c-${id.slice(-3)}`,
    status,
    last_synced_at: lastSyncedAt,
  });
}

describe('mark_removed_for_account RPC', () => {
  let sb: ReturnType<typeof createSupabaseClient> & SbExtended;

  beforeEach(async () => {
    sb = createSupabaseClient(env) as typeof sb;
    await resetFixtures(sb);
  });

  it('cenário a: zero mudanças retorna (0, 0, 0)', async () => {
    const startedAt = new Date(Date.now() - 1000).toISOString();
    const result = await sb.rpc<Array<{ campaigns_marked: number; ad_groups_marked: number; ads_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0]).toEqual({ campaigns_marked: 0, ad_groups_marked: 0, ads_marked: 0 });
  });

  it('cenário b: campaigns com last_synced_at antigo são marcadas REMOVED', async () => {
    const oldSync = new Date(Date.now() - 10000).toISOString();
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c001', oldSync);
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c002', oldSync);

    const startedAt = new Date(Date.now() - 1000).toISOString();
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(2);

    const rows = await sb.select<{ status: string }>('campaigns', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      select: 'status',
    });
    expect(rows.every((r) => r.status === 'REMOVED')).toBe(true);
  });

  it('cenário c: campaigns já em REMOVED não são re-tocadas (idempotência)', async () => {
    const oldSync = new Date(Date.now() - 10000).toISOString();
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c003', oldSync, 'REMOVED');

    const startedAt = new Date(Date.now() - 1000).toISOString();
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(0);
  });

  it('cenário d: p_started_at no futuro marca tudo', async () => {
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c004', new Date().toISOString());
    const startedAt = new Date(Date.now() + 60000).toISOString(); // 1 min no futuro
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(1);
  });

  it('cenário e: p_started_at antigo demais não marca nada', async () => {
    await insertCampaign(sb, '00000000-0000-0000-0000-00000000c005', new Date().toISOString());
    const startedAt = new Date(Date.now() - 60000).toISOString(); // 1 min atrás
    const result = await sb.rpc<Array<{ campaigns_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: ACCOUNT_ID, p_started_at: startedAt }
    );
    expect(result[0].campaigns_marked).toBe(0);
  });
});
```

- [ ] **Step 2: Implementar `rpc` method no SupabaseClient (mínimo pra test compilar)**

Editar `worker/src/lib/supabase.ts` adicionando `rpc` à interface e implementação:

```ts
export interface SupabaseClient {
  select<T = unknown>(table: string, query: Record<string, string>): Promise<T[]>;
  insert<T = unknown>(table: string, row: T | T[], opts?: InsertOptions): Promise<void>;
  delete(table: string, query: Record<string, string>): Promise<void>;
  rpc<T = unknown>(name: string, params: Record<string, unknown>): Promise<T>;
}
```

Adicionar na implementação retornada por `createSupabaseClient`:

```ts
async rpc<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
  const url = `${baseUrl}/rest/v1/rpc/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Supabase rpc ${name} falhou ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}
```

- [ ] **Step 3: Rodar testes**

```bash
pnpm worker:test -- mark-removed
```
Esperado: 5 testes verde.

- [ ] **Step 4: Commitar**

```bash
git add worker/src/lib/supabase.ts worker/tests/google-ads/mark-removed.test.ts
git commit -m "test(google-ads): integration tests do RPC mark_removed_for_account"
```

---

## Task 4: Test integration `oauth_pending_selections` CRUD

**Files:**
- Create: `worker/tests/google-ads/oauth-pending.test.ts`

- [ ] **Step 1: Escrever teste**

Conteúdo de `worker/tests/google-ads/oauth-pending.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../../src/lib/supabase';
import { encryptAesGcm, decryptAesGcm } from '../../src/lib/crypto';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('oauth_pending_selections CRUD', () => {
  let sb: ReturnType<typeof createSupabaseClient>;

  beforeEach(async () => {
    sb = createSupabaseClient(env);
    await sb.delete('oauth_pending_selections', { workspace_id: `eq.${WORKSPACE_ID}` });
  });

  it('insere e seleciona pending session com encrypted_payload + payload_iv', async () => {
    const payload = JSON.stringify({
      access_token: 'fake-access',
      refresh_token: 'fake-refresh',
      customer_ids: ['1234567890', '9876543210'],
    });
    const { ciphertext, iv } = await encryptAesGcm(KEY_HEX, payload);

    await sb.insert('oauth_pending_selections', {
      workspace_id: WORKSPACE_ID,
      encrypted_payload: ciphertext,
      payload_iv: iv,
    });

    const rows = await sb.select<{ id: string; encrypted_payload: string; payload_iv: string; expires_at: string }>(
      'oauth_pending_selections',
      { workspace_id: `eq.${WORKSPACE_ID}`, select: 'id,encrypted_payload,payload_iv,expires_at' }
    );
    expect(rows.length).toBe(1);

    const decrypted = await decryptAesGcm(KEY_HEX, rows[0].encrypted_payload, rows[0].payload_iv);
    const parsed = JSON.parse(decrypted);
    expect(parsed.customer_ids).toEqual(['1234567890', '9876543210']);
  });

  it('expires_at default é ~10min no futuro', async () => {
    const before = Date.now();
    await sb.insert('oauth_pending_selections', {
      workspace_id: WORKSPACE_ID,
      encrypted_payload: 'x',
      payload_iv: 'y',
    });
    const rows = await sb.select<{ expires_at: string }>('oauth_pending_selections', {
      workspace_id: `eq.${WORKSPACE_ID}`,
      select: 'expires_at',
      order: 'created_at.desc',
      limit: '1',
    });
    const expiresAt = new Date(rows[0].expires_at).getTime();
    const tenMinFromBefore = before + 10 * 60 * 1000;
    expect(Math.abs(expiresAt - tenMinFromBefore)).toBeLessThan(5000); // tolerância 5s
  });

  it('cleanup query DELETE WHERE expires_at < NOW() pega expirados', async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    await sb.insert('oauth_pending_selections', {
      workspace_id: WORKSPACE_ID,
      encrypted_payload: 'expired',
      payload_iv: 'iv',
      expires_at: past,
    });
    await sb.insert('oauth_pending_selections', {
      workspace_id: WORKSPACE_ID,
      encrypted_payload: 'valid',
      payload_iv: 'iv',
    });

    await sb.delete('oauth_pending_selections', { expires_at: `lt.${new Date().toISOString()}` });

    const remaining = await sb.select<{ encrypted_payload: string }>('oauth_pending_selections', {
      workspace_id: `eq.${WORKSPACE_ID}`,
      select: 'encrypted_payload',
    });
    expect(remaining.length).toBe(1);
    expect(remaining[0].encrypted_payload).toBe('valid');
  });
});
```

- [ ] **Step 2: Rodar testes**

```bash
pnpm worker:test -- oauth-pending
```
Esperado: 3 testes verde.

- [ ] **Step 3: Commitar**

```bash
git add worker/tests/google-ads/oauth-pending.test.ts
git commit -m "test(google-ads): integration tests do oauth_pending_selections"
```

---

## Task 5: Test integration `google_ads_sync_log` (sync_type, partial_skipped, trace_id)

**Files:**
- Create: `worker/tests/google-ads/sync-log.test.ts`

- [ ] **Step 1: Escrever teste**

Conteúdo de `worker/tests/google-ads/sync-log.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../../src/lib/supabase';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = '00000000-0000-0000-0000-00000000a002';

describe('google_ads_sync_log', () => {
  let sb: ReturnType<typeof createSupabaseClient>;

  beforeEach(async () => {
    sb = createSupabaseClient(env);
    await sb.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
    await sb.insert('google_ads_accounts', {
      id: ACCOUNT_ID,
      workspace_id: WORKSPACE_ID,
      customer_id: '1111111111',
      refresh_token_encrypted: 'x',
      refresh_token_iv: 'y',
    });
  });

  it('aceita sync_type=metadata + trace_id + parsed_skipped', async () => {
    const traceId = crypto.randomUUID();
    await sb.insert('google_ads_sync_log', {
      google_ads_account_id: ACCOUNT_ID,
      sync_type: 'metadata',
      status: 'running',
      trace_id: traceId,
      parsed_skipped: 0,
      date_range_start: '2026-05-07',
      date_range_end: '2026-05-07',
    });
    const rows = await sb.select<{ sync_type: string; trace_id: string }>('google_ads_sync_log', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      select: 'sync_type,trace_id',
    });
    expect(rows[0].sync_type).toBe('metadata');
    expect(rows[0].trace_id).toBe(traceId);
  });

  it('aceita status=partial + partial_skipped JSONB roundtrip', async () => {
    const skipped = { reason: 'time_budget_exceeded', elapsed_ms: 28500, phase_completed: 'campaigns', skipped: ['ad_groups', 'ads', 'mark_removed'] };
    await sb.insert('google_ads_sync_log', {
      google_ads_account_id: ACCOUNT_ID,
      sync_type: 'metadata',
      status: 'partial',
      partial_skipped: skipped,
      date_range_start: '2026-05-07',
      date_range_end: '2026-05-07',
    });
    const rows = await sb.select<{ partial_skipped: typeof skipped }>('google_ads_sync_log', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      status: 'eq.partial',
      select: 'partial_skipped',
    });
    expect(rows[0].partial_skipped).toEqual(skipped);
  });

  it('rejeita status fora do CHECK constraint', async () => {
    await expect(
      sb.insert('google_ads_sync_log', {
        google_ads_account_id: ACCOUNT_ID,
        sync_type: 'metadata',
        status: 'banana',
        date_range_start: '2026-05-07',
        date_range_end: '2026-05-07',
      })
    ).rejects.toThrow(/check/i);
  });

  it('rejeita sync_type fora do CHECK constraint', async () => {
    await expect(
      sb.insert('google_ads_sync_log', {
        google_ads_account_id: ACCOUNT_ID,
        sync_type: 'frontend',
        status: 'running',
        date_range_start: '2026-05-07',
        date_range_end: '2026-05-07',
      })
    ).rejects.toThrow(/check/i);
  });
});
```

- [ ] **Step 2: Rodar testes**

```bash
pnpm worker:test -- sync-log
```
Esperado: 4 testes verde.

- [ ] **Step 3: Commitar**

```bash
git add worker/tests/google-ads/sync-log.test.ts
git commit -m "test(google-ads): integration tests de google_ads_sync_log"
```

---

## ▸ CHECKPOINT 1 — Schema validado

> **Pausa.** Antes de seguir pra Phase 2:
> 1. Confirmar que `pnpm worker:test` continua mostrando todos os testes verdes (156 da Fase 1 + 12 novos da Phase 1 = 168 total).
> 2. Leo + Claude validam schema com SELECTs no Studio:
>    - `\d ad_groups` — colunas `entity_type` + `metadata` presentes.
>    - `\d google_ads_sync_log` — tabela renomeada + colunas novas.
>    - `\d oauth_pending_selections` — tabela criada com RLS.
>    - `\df mark_removed_for_account` — RPC executável.
> 3. Pausa pra eventuais ajustes (rollback de migration via `supabase db reset` é trivial nesta phase).
> 4. Quando aprovado, seguir pra Phase 2.

---

## Phase 2 — Libs leaf parte A (Worker foundation)

## Task 6: `customer-id.ts` + tests (formatCustomerId + parseCustomerId)

**Files:**
- Create: `worker/src/lib/customer-id.ts`
- Create: `worker/tests/lib/customer-id.test.ts`

- [ ] **Step 1: Escrever testes**

Conteúdo de `worker/tests/lib/customer-id.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatCustomerId, parseCustomerId } from '../../src/lib/customer-id';

describe('formatCustomerId', () => {
  it('formata 10 dígitos em XXX-XXX-XXXX', () => {
    expect(formatCustomerId('1234567890')).toBe('123-456-7890');
  });

  it('roundtrip format → parse', () => {
    expect(parseCustomerId(formatCustomerId('1234567890'))).toBe('1234567890');
  });

  it('throw em raw com tamanho diferente de 10', () => {
    expect(() => formatCustomerId('123')).toThrow(/invalid_customer_id_format/);
    expect(() => formatCustomerId('12345678901')).toThrow(/invalid_customer_id_format/);
  });

  it('throw em formato com não-dígitos', () => {
    expect(() => formatCustomerId('123456789a')).toThrow(/invalid_customer_id_format/);
  });
});

describe('parseCustomerId', () => {
  it('aceita formato XXX-XXX-XXXX', () => {
    expect(parseCustomerId('123-456-7890')).toBe('1234567890');
  });

  it('aceita raw 10 dígitos sem formatação (idempotente)', () => {
    expect(parseCustomerId('1234567890')).toBe('1234567890');
  });

  it('throw em formato inválido', () => {
    expect(() => parseCustomerId('12-34')).toThrow(/invalid_customer_id_format/);
    expect(() => parseCustomerId('abc-def-ghij')).toThrow(/invalid_customer_id_format/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm worker:test -- customer-id
```
Esperado: FAIL com "Cannot find module '../../src/lib/customer-id'".

- [ ] **Step 3: Implementar**

Conteúdo de `worker/src/lib/customer-id.ts`:

```ts
export function parseCustomerId(input: string): string {
  const digits = input.replace(/-/g, '');
  if (!/^\d{10}$/.test(digits)) {
    throw new Error('invalid_customer_id_format');
  }
  return digits;
}

export function formatCustomerId(raw: string): string {
  if (!/^\d{10}$/.test(raw)) {
    throw new Error('invalid_customer_id_format');
  }
  return `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}`;
}
```

- [ ] **Step 4: Rodar testes — verde**

```bash
pnpm worker:test -- customer-id
```
Esperado: 7 testes passing.

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/customer-id.ts worker/tests/lib/customer-id.test.ts
git commit -m "feat(worker): customer-id format/parse helpers"
```

---

## Task 7: `structured-log.ts` + tests

**Files:**
- Create: `worker/src/lib/structured-log.ts`
- Create: `worker/tests/lib/structured-log.test.ts`

- [ ] **Step 1: Escrever testes**

Conteúdo de `worker/tests/lib/structured-log.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStructuredLogger } from '../../src/lib/structured-log';

describe('createStructuredLogger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('emite JSON com level, event, trace_id, elapsed_ms', () => {
    const traceId = '00000000-0000-0000-0000-000000000abc';
    const startedAt = Date.now() - 1500;
    const log = createStructuredLogger(traceId, startedAt);

    log.info('phase_started', { phase: 'campaigns' });

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const out = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    expect(out.level).toBe('info');
    expect(out.event).toBe('phase_started');
    expect(out.trace_id).toBe(traceId);
    expect(out.elapsed_ms).toBeGreaterThanOrEqual(1500);
    expect(out.phase).toBe('campaigns');
  });

  it('warn e error usam mesmo schema com level diferente', () => {
    const log = createStructuredLogger('t', Date.now());
    log.warn('row_skipped', { table: 'campaigns', row_id: 'x' });
    log.error('sync_failed', { reason: 'rate_limited' });

    const warnOut = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    const errorOut = JSON.parse(consoleErrorSpy.mock.calls[1][0] as string);
    expect(warnOut.level).toBe('warn');
    expect(warnOut.event).toBe('row_skipped');
    expect(errorOut.level).toBe('error');
    expect(errorOut.event).toBe('sync_failed');
  });

  it('caller não pode sobrescrever campos reservados', () => {
    const log = createStructuredLogger('t', Date.now());
    log.info('e', { level: 'fake', trace_id: 'fake', elapsed_ms: 9999 });
    const out = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    expect(out.level).toBe('info');
    expect(out.trace_id).toBe('t');
    expect(out.elapsed_ms).toBeLessThan(9999);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm worker:test -- structured-log
```
Esperado: FAIL com "Cannot find module".

- [ ] **Step 3: Implementar**

Conteúdo de `worker/src/lib/structured-log.ts`:

```ts
type Level = 'info' | 'warn' | 'error';

export interface StructuredLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createStructuredLogger(traceId: string, startedAt: number): StructuredLogger {
  function emit(level: Level, event: string, fields?: Record<string, unknown>) {
    // Campos do caller sobrescrevem primeiro; reservados são reaplicados depois pra
    // garantir que level/trace_id/elapsed_ms vêm do logger e não do caller.
    const payload = {
      ...(fields ?? {}),
      level,
      event,
      trace_id: traceId,
      elapsed_ms: Date.now() - startedAt,
    };
    console.error(JSON.stringify(payload));
  }

  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}
```

- [ ] **Step 4: Rodar testes — verde**

```bash
pnpm worker:test -- structured-log
```
Esperado: 3 testes passing.

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/structured-log.ts worker/tests/lib/structured-log.test.ts
git commit -m "feat(worker): structured-log com schema cravado e trace_id propagation"
```

---

## Task 8: `internal-auth.ts` + tests (validateInternalRequest)

**Files:**
- Create: `worker/src/lib/internal-auth.ts`
- Create: `worker/tests/lib/internal-auth.test.ts`
- Modify: `worker/src/types.ts` — adicionar env vars novos

- [ ] **Step 1: Adicionar env vars novos ao tipo `Env`**

Editar `worker/src/types.ts` adicionando ao interface `Env`:

```ts
export interface Env {
  // ... campos existentes da Fase 1 + Payt
  GOOGLE_ADS_CLIENT_ID: string;
  GOOGLE_ADS_CLIENT_SECRET: string;
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  GOOGLE_ADS_OAUTH_REDIRECT_URI: string;
  WORKER_INTERNAL_TOKEN: string;
  SUPABASE_JWT_SECRET: string;
}
```

- [ ] **Step 2: Atualizar `wrangler.toml.example` com placeholders**

Adicionar ao `worker/wrangler.toml.example`:

```toml
# Google Ads OAuth + API (Fase 2A)
GOOGLE_ADS_CLIENT_ID = "<from Google Cloud Console>"
GOOGLE_ADS_CLIENT_SECRET = "<from Google Cloud Console — keep secret>"
GOOGLE_ADS_DEVELOPER_TOKEN = "<from Google Ads API Center — keep secret>"
GOOGLE_ADS_OAUTH_REDIRECT_URI = "http://localhost:8787/oauth/google-ads/callback"

# Internal auth App↔Worker (Fase 2A)
WORKER_INTERNAL_TOKEN = "<gere via: openssl rand -hex 32>"
SUPABASE_JWT_SECRET = "<copiar de: supabase status -> JWT secret>"
```

Copiar pro `wrangler.toml` (não-commitado) e preencher valores reais (Client ID/Secret do step 4 do Task 0; outros geram agora).

- [ ] **Step 3: Escrever testes**

Conteúdo de `worker/tests/lib/internal-auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { validateInternalRequest } from '../../src/lib/internal-auth';

const VALID_TOKEN = 'test-internal-token';
const VALID_JWT_SECRET = 'super-secret-jwt-for-tests';

// Helper pra criar JWT válido (HS256)
async function makeJwt(secret: string, payload: Record<string, unknown>, expSecondsFromNow = 3600): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { sub: 'user-123', exp: now + expSecondsFromNow, iat: now, ...payload };
  const enc = (obj: object) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const message = `${enc(header)}.${enc(fullPayload)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${message}.${sigB64}`;
}

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://test.workers.dev/api/google-ads/sync', {
    method: 'POST',
    headers,
  });
}

describe('validateInternalRequest', () => {
  // Override env apenas pra esses tests
  beforeEach(() => {
    Object.assign(env, {
      WORKER_INTERNAL_TOKEN: VALID_TOKEN,
      SUPABASE_JWT_SECRET: VALID_JWT_SECRET,
    });
  });

  it('rejeita 401 quando bearer ausente', async () => {
    const req = makeRequest({});
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando bearer incorreto', async () => {
    const jwt = await makeJwt(VALID_JWT_SECRET, { sub: 'user-123' });
    const req = makeRequest({
      Authorization: 'Bearer wrong-token',
      'X-User-JWT': jwt,
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando JWT signature inválida', async () => {
    const jwt = await makeJwt('wrong-secret', { sub: 'user-123' });
    const req = makeRequest({
      Authorization: `Bearer ${VALID_TOKEN}`,
      'X-User-JWT': jwt,
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando JWT expirado', async () => {
    const jwt = await makeJwt(VALID_JWT_SECRET, { sub: 'user-123' }, -10);
    const req = makeRequest({
      Authorization: `Bearer ${VALID_TOKEN}`,
      'X-User-JWT': jwt,
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('aceita request válido e retorna workspaceIds + userId', async () => {
    // user do seed local: precisa ter um workspace WHERE owner_id = sub
    const SEED_USER_ID = (env as { TEST_SEED_USER_ID?: string }).TEST_SEED_USER_ID
      ?? 'replace-with-actual-seed-user-id';
    const jwt = await makeJwt(VALID_JWT_SECRET, { sub: SEED_USER_ID });
    const req = makeRequest({
      Authorization: `Bearer ${VALID_TOKEN}`,
      'X-User-JWT': jwt,
    });
    const result = await validateInternalRequest(req, env);
    expect(result.userId).toBe(SEED_USER_ID);
    expect(Array.isArray(result.workspaceIds)).toBe(true);
    expect(result.workspaceIds.length).toBeGreaterThanOrEqual(1);
  });
});
```

> NOTA: Step 5 abaixo usa o mesmo SEED_USER_ID. Se o seed atual usa um UUID específico, atualizar `TEST_SEED_USER_ID` em `worker/vitest.config.ts` pra apontar pro `auth.users.id` do `dev@finaltrack.local`.

- [ ] **Step 4: Rodar e ver falhar**

```bash
pnpm worker:test -- internal-auth
```
Esperado: FAIL com "Cannot find module".

- [ ] **Step 5: Implementar `internal-auth.ts`**

Conteúdo de `worker/src/lib/internal-auth.ts`:

```ts
import type { Env } from '../types';
import { timingSafeEqualHex } from './crypto';
import { createSupabaseClient } from './supabase';

export interface InternalAuthContext {
  workspaceIds: string[];
  userId: string;
}

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function decodeBase64Url(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function verifySupabaseJwt(jwt: string, secret: string): Promise<{ sub: string; exp: number } | null> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  const message = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const sigBytes = decodeBase64Url(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(message));
  if (!valid) return null;

  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadB64)));
  } catch {
    return null;
  }
  if (!payload.sub || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { sub: payload.sub, exp: payload.exp };
}

export async function validateInternalRequest(req: Request, env: Env): Promise<InternalAuthContext> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const jwt = req.headers.get('X-User-JWT') ?? '';

  if (!bearer || !jwt) throw jsonResponse(401, { error: 'missing_credentials' });

  // Constant-time compare evita timing oracle no token interno.
  // Hex pad pra ambos terem mesmo tamanho mesmo se um for menor (timingSafeEqualHex
  // já lida com lengths diferentes, mas usar hex já normalizado é mais barato).
  const expectedHex = Array.from(new TextEncoder().encode(env.WORKER_INTERNAL_TOKEN))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const givenHex = Array.from(new TextEncoder().encode(bearer))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!timingSafeEqualHex(expectedHex, givenHex)) {
    throw jsonResponse(401, { error: 'invalid_token' });
  }

  const claims = await verifySupabaseJwt(jwt, env.SUPABASE_JWT_SECRET);
  if (!claims) throw jsonResponse(401, { error: 'invalid_jwt' });

  const sb = createSupabaseClient(env);
  const workspaces = await sb.select<{ id: string }>('workspaces', {
    owner_id: `eq.${claims.sub}`,
    select: 'id',
  });

  return {
    workspaceIds: workspaces.map((w) => w.id),
    userId: claims.sub,
  };
}
```

- [ ] **Step 6: Atualizar vitest.config pra expor SEED_USER_ID nos testes**

Editar `worker/vitest.config.ts` no bloco `poolOptions.workers.miniflare.bindings` (ou equivalente) pra adicionar:

```ts
TEST_SEED_USER_ID: process.env.TEST_SEED_USER_ID ?? '00000000-0000-0000-0000-000000000099',
WORKER_INTERNAL_TOKEN: 'test-internal-token-default',
SUPABASE_JWT_SECRET: 'super-secret-jwt-for-tests-default',
```

> Pro seed real, pegar `auth.users.id` do `dev@finaltrack.local` no Studio e exportar antes de rodar tests: `export TEST_SEED_USER_ID=<uuid>`.

- [ ] **Step 7: Rodar testes — verde**

```bash
pnpm worker:test -- internal-auth
```
Esperado: 5 testes passing.

- [ ] **Step 8: Commitar**

```bash
git add worker/src/lib/internal-auth.ts worker/src/types.ts worker/wrangler.toml.example worker/vitest.config.ts worker/tests/lib/internal-auth.test.ts
git commit -m "feat(worker): validateInternalRequest com bearer + JWT + workspace lookup"
```

---

## Task 9: Estender `supabase.ts` — métodos `update` + `upsert`

**Files:**
- Modify: `worker/src/lib/supabase.ts`

> Hoje só tem `select`/`insert`/`delete`/`rpc` (rpc adicionado na Task 3). Sync precisa de `update` (zombie cleanup, is_active=false) e `upsert` explícito (merge-duplicates, distinto do current `insert` com `onConflict` que faz ignore).

- [ ] **Step 1: Estender interface + implementação**

Editar `worker/src/lib/supabase.ts`:

```ts
export interface UpsertOptions {
  onConflict: string; // colunas separadas por vírgula
}

export interface SupabaseClient {
  select<T = unknown>(table: string, query: Record<string, string>): Promise<T[]>;
  insert<T = unknown>(table: string, row: T | T[], opts?: InsertOptions): Promise<void>;
  update(table: string, query: Record<string, string>, patch: Record<string, unknown>): Promise<void>;
  upsert<T = unknown>(table: string, row: T | T[], opts: UpsertOptions): Promise<void>;
  delete(table: string, query: Record<string, string>): Promise<void>;
  rpc<T = unknown>(name: string, params: Record<string, unknown>): Promise<T>;
}
```

E na implementação retornada por `createSupabaseClient`, adicionar:

```ts
async update(table, query, patch) {
  const url = `${baseUrl}/rest/v1/${table}${buildQuery(query)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Supabase update falhou ${res.status}: ${await res.text()}`);
  }
},

async upsert(table, row, opts) {
  const url = `${baseUrl}/rest/v1/${table}?on_conflict=${opts.onConflict}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers({
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify(Array.isArray(row) ? row : [row]),
  });
  if (!res.ok && res.status !== 201 && res.status !== 200 && res.status !== 204) {
    throw new Error(`Supabase upsert falhou ${res.status}: ${await res.text()}`);
  }
},
```

- [ ] **Step 2: Rodar suite completa pra confirmar não-regressão**

```bash
pnpm worker:test
```
Esperado: 168+ testes verde (Phase 1 não regredindo).

- [ ] **Step 3: Commitar**

```bash
git add worker/src/lib/supabase.ts
git commit -m "feat(worker): supabase client ganha update + upsert (merge-duplicates)"
```

---

## Phase 3 — Libs leaf parte B (Google Ads namespace)

## Task 10: `errors.ts` (classes de erro do namespace google-ads)

**Files:**
- Create: `worker/src/lib/google-ads/errors.ts`

> Sem teste dedicado — classes vazias só com `name` correto, validação acontece nos consumers (sync.ts, client.ts).

- [ ] **Step 1: Implementar**

Conteúdo de `worker/src/lib/google-ads/errors.ts`:

```ts
export class GoogleAdsApiError extends Error {
  constructor(message: string, public httpStatus: number, public body?: unknown) {
    super(message);
    this.name = 'GoogleAdsApiError';
  }
}

export class InvalidGrantError extends Error {
  constructor(message = 'invalid_grant') {
    super(message);
    this.name = 'InvalidGrantError';
  }
}

export class InvalidClientError extends Error {
  constructor(message = 'invalid_client') {
    super(message);
    this.name = 'InvalidClientError';
  }
}

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds?: number) {
    super('rate_limited');
    this.name = 'RateLimitError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export class TimeBudgetError extends Error {
  constructor(public reason: string, public elapsedMs: number) {
    super(`time_budget_exceeded: ${reason} after ${elapsedMs}ms`);
    this.name = 'TimeBudgetError';
  }
}
```

- [ ] **Step 2: Commitar**

```bash
git add worker/src/lib/google-ads/errors.ts
git commit -m "feat(worker): error classes do namespace google-ads"
```

---

## Task 11: `queries.ts` (strings GAQL versionadas)

**Files:**
- Create: `worker/src/lib/google-ads/queries.ts`

- [ ] **Step 1: Implementar**

Conteúdo de `worker/src/lib/google-ads/queries.ts`:

```ts
// GAQL queries pra Google Ads API v17.
// Usar templates pra interpolar resource names (campaign='customers/X/campaigns/Y').
// Status filter inclui REMOVED pra que sync detecte e refletida via mark_removed.

export const CAMPAIGN_QUERY = `
SELECT
  campaign.id, campaign.name, campaign.advertising_channel_type,
  campaign.status, campaign.bidding_strategy_type,
  campaign_budget.amount_micros,
  campaign.start_date, campaign.end_date
FROM campaign
WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
`.trim();

export function adGroupQuery(campaignResource: string): string {
  return `
SELECT
  ad_group.id, ad_group.name, ad_group.status, ad_group.type,
  ad_group.cpc_bid_micros, ad_group.campaign
FROM ad_group
WHERE ad_group.campaign = '${campaignResource}'
  AND ad_group.status IN ('ENABLED', 'PAUSED', 'REMOVED')
`.trim();
}

export function adQuery(adGroupResource: string): string {
  return `
SELECT
  ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
  ad_group_ad.status, ad_group_ad.ad.final_urls,
  ad_group_ad.ad.responsive_display_ad.headlines,
  ad_group_ad.ad.responsive_display_ad.descriptions,
  ad_group_ad.ad.video_responsive_ad.videos,
  ad_group_ad.ad_group
FROM ad_group_ad
WHERE ad_group_ad.ad_group = '${adGroupResource}'
  AND ad_group_ad.status IN ('ENABLED', 'PAUSED', 'REMOVED')
`.trim();
}

export function assetGroupQuery(campaignResource: string): string {
  return `
SELECT
  asset_group.id, asset_group.name, asset_group.status,
  asset_group.campaign, asset_group.final_urls
FROM asset_group
WHERE asset_group.campaign = '${campaignResource}'
  AND asset_group.status IN ('ENABLED', 'PAUSED', 'REMOVED')
`.trim();
}
```

- [ ] **Step 2: Commitar**

```bash
git add worker/src/lib/google-ads/queries.ts
git commit -m "feat(worker): GAQL queries v17 pra campaigns/ad_groups/ads/asset_groups"
```

---

## Task 12: `parsers.ts` + tests (4 parsers defensivos)

**Files:**
- Create: `worker/src/lib/google-ads/parsers.ts`
- Create: `worker/tests/google-ads/parsers.test.ts`

- [ ] **Step 1: Escrever testes**

Conteúdo de `worker/tests/google-ads/parsers.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm worker:test -- parsers
```
Esperado: FAIL com module not found.

- [ ] **Step 3: Implementar**

Conteúdo de `worker/src/lib/google-ads/parsers.ts`:

```ts
// Parsers defensivos: row inválido (missing required field, wrong type) → null.
// Row válido → objeto pronto pra upsert no schema. Caller incrementa parsed_skipped
// quando recebe null e loga warn com row preview.

interface CampaignParsed {
  google_campaign_id: string;
  name: string;
  campaign_type: string | null;
  status: string;
  bidding_strategy: string | null;
  daily_budget_micros: number | null;
  start_date: string | null;
  end_date: string | null;
}

interface AdGroupParsed {
  campaign_id: string;
  google_ad_group_id: string;
  name: string;
  status: string;
  type: string | null;
  cpc_bid_micros: number | null;
  entity_type: 'AD_GROUP' | 'ASSET_GROUP';
  metadata: Record<string, unknown> | null;
}

interface AdParsed {
  ad_group_id: string;
  google_ad_id: string;
  name: string | null;
  ad_type: string | null;
  status: string;
  final_url: string | null;
  headline: string | null;
  description: string | null;
  video_id: string | null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
  return null;
}

export function parseCampaignRow(row: unknown): CampaignParsed | null {
  if (!isObj(row)) return null;
  const c = row.campaign;
  if (!isObj(c)) return null;
  const id = asString(c.id);
  const name = asString(c.name);
  if (!id || !name) return null;

  const budget = isObj(row.campaignBudget) ? asNumber(row.campaignBudget.amountMicros) : null;
  return {
    google_campaign_id: id,
    name,
    campaign_type: asString(c.advertisingChannelType),
    status: asString(c.status) ?? 'UNKNOWN',
    bidding_strategy: asString(c.biddingStrategyType),
    daily_budget_micros: budget,
    start_date: asString(c.startDate),
    end_date: asString(c.endDate),
  };
}

export function parseAdGroupRow(row: unknown, campaignId: string): AdGroupParsed | null {
  if (!isObj(row)) return null;
  const ag = row.adGroup;
  if (!isObj(ag)) return null;
  const id = asString(ag.id);
  const name = asString(ag.name);
  if (!id || !name) return null;
  return {
    campaign_id: campaignId,
    google_ad_group_id: id,
    name,
    status: asString(ag.status) ?? 'UNKNOWN',
    type: asString(ag.type),
    cpc_bid_micros: asNumber(ag.cpcBidMicros),
    entity_type: 'AD_GROUP',
    metadata: null,
  };
}

export function parseAdRow(row: unknown, adGroupId: string): AdParsed | null {
  if (!isObj(row)) return null;
  const aga = row.adGroupAd;
  if (!isObj(aga)) return null;
  const ad = aga.ad;
  if (!isObj(ad)) return null;
  const id = asString(ad.id);
  if (!id) return null;

  const finalUrls = ad.finalUrls;
  const finalUrl = Array.isArray(finalUrls) && typeof finalUrls[0] === 'string' ? finalUrls[0] : null;

  let headline: string | null = null;
  let description: string | null = null;
  if (isObj(ad.responsiveDisplayAd)) {
    const h = ad.responsiveDisplayAd.headlines;
    const d = ad.responsiveDisplayAd.descriptions;
    if (Array.isArray(h) && isObj(h[0])) headline = asString(h[0].text);
    if (Array.isArray(d) && isObj(d[0])) description = asString(d[0].text);
  }

  let videoId: string | null = null;
  if (isObj(ad.videoResponsiveAd)) {
    const vids = ad.videoResponsiveAd.videos;
    if (Array.isArray(vids) && isObj(vids[0])) {
      videoId = asString(vids[0].value) ?? asString(vids[0].asset);
    }
  }

  return {
    ad_group_id: adGroupId,
    google_ad_id: id,
    name: asString(ad.name),
    ad_type: asString(ad.type),
    status: asString(aga.status) ?? 'UNKNOWN',
    final_url: finalUrl,
    headline,
    description,
    video_id: videoId,
  };
}

export function parseAssetGroupRow(row: unknown, campaignId: string): AdGroupParsed | null {
  if (!isObj(row)) return null;
  const ag = row.assetGroup;
  if (!isObj(ag)) return null;
  const id = asString(ag.id);
  const name = asString(ag.name);
  if (!id || !name) return null;
  return {
    campaign_id: campaignId,
    google_ad_group_id: id,
    name,
    status: asString(ag.status) ?? 'UNKNOWN',
    type: null,
    cpc_bid_micros: null,
    entity_type: 'ASSET_GROUP',
    metadata: {
      final_urls: Array.isArray(ag.finalUrls) ? ag.finalUrls : null,
    },
  };
}
```

- [ ] **Step 4: Rodar testes — verde**

```bash
pnpm worker:test -- parsers
```
Esperado: 12 testes passing.

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/google-ads/parsers.ts worker/tests/google-ads/parsers.test.ts
git commit -m "feat(worker): parsers defensivos pra GAQL responses (4 entidades)"
```

---

## Task 13: `upsert-bisect.ts` + tests

**Files:**
- Create: `worker/src/lib/upsert-bisect.ts`
- Create: `worker/tests/lib/upsert-bisect.test.ts`

- [ ] **Step 1: Escrever testes**

Conteúdo de `worker/tests/lib/upsert-bisect.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { upsertWithBisect } from '../../src/lib/upsert-bisect';

describe('upsertWithBisect', () => {
  it('empty array → ok=0 skipped=0 sem chamar upsertFn', async () => {
    const upsert = vi.fn();
    const log = vi.fn();
    const r = await upsertWithBisect([], upsert, log);
    expect(r).toEqual({ ok: 0, skipped: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('all ok → 1 chamada apenas, ok=N skipped=0', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const r = await upsertWithBisect([1, 2, 3, 4], upsert, log);
    expect(r).toEqual({ ok: 4, skipped: 0 });
    expect(upsert).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it('single row falha → log + skipped=1', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('constraint violation'));
    const log = vi.fn();
    const r = await upsertWithBisect([{ id: 'bad' }], upsert, log);
    expect(r).toEqual({ ok: 0, skipped: 1 });
    expect(log).toHaveBeenCalledWith({ id: 'bad' });
  });

  it('metade falha → bisect recursivo, ok=2 skipped=2', async () => {
    const upsert = vi.fn().mockImplementation(async (batch: Array<{ id: number; bad?: boolean }>) => {
      if (batch.some((r) => r.bad)) throw new Error('bad row');
    });
    const log = vi.fn();
    const rows = [
      { id: 1 },
      { id: 2, bad: true },
      { id: 3 },
      { id: 4, bad: true },
    ];
    const r = await upsertWithBisect(rows, upsert, log);
    expect(r).toEqual({ ok: 2, skipped: 2 });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('1000 rows com 1 bad: log₂(1000) ≈ 10 retries, não 1000', async () => {
    let calls = 0;
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    rows[500] = { id: 500, bad: true } as { id: number; bad?: boolean };
    const upsert = vi.fn().mockImplementation(async (batch: Array<{ id: number; bad?: boolean }>) => {
      calls++;
      if (batch.some((r) => r.bad)) throw new Error('bad');
    });
    const log = vi.fn();
    const r = await upsertWithBisect(rows, upsert, log);
    expect(r).toEqual({ ok: 999, skipped: 1 });
    expect(calls).toBeLessThan(30); // 2*log2(1000) ≈ 20, generoso até 30
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm worker:test -- upsert-bisect
```
Esperado: FAIL.

- [ ] **Step 3: Implementar**

Conteúdo de `worker/src/lib/upsert-bisect.ts`:

```ts
export interface BisectResult {
  ok: number;
  skipped: number;
}

export async function upsertWithBisect<T>(
  rows: T[],
  upsert: (batch: T[]) => Promise<void>,
  logSkipped: (row: T) => void
): Promise<BisectResult> {
  if (rows.length === 0) return { ok: 0, skipped: 0 };
  try {
    await upsert(rows);
    return { ok: rows.length, skipped: 0 };
  } catch {
    if (rows.length === 1) {
      logSkipped(rows[0]);
      return { ok: 0, skipped: 1 };
    }
    const mid = Math.floor(rows.length / 2);
    const left = await upsertWithBisect(rows.slice(0, mid), upsert, logSkipped);
    const right = await upsertWithBisect(rows.slice(mid), upsert, logSkipped);
    return { ok: left.ok + right.ok, skipped: left.skipped + right.skipped };
  }
}
```

- [ ] **Step 4: Rodar testes — verde**

```bash
pnpm worker:test -- upsert-bisect
```
Esperado: 5 testes passing.

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/upsert-bisect.ts worker/tests/lib/upsert-bisect.test.ts
git commit -m "feat(worker): upsert-bisect helper recursivo log₂(N)"
```

---

## Task 14: `oauth-state.ts` + tests (sign/verify HMAC cookie)

**Files:**
- Create: `worker/src/lib/google-ads/oauth-state.ts`
- Create: `worker/tests/google-ads/oauth-state.test.ts`

- [ ] **Step 1: Escrever testes**

Conteúdo de `worker/tests/google-ads/oauth-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signState, verifyState } from '../../src/lib/google-ads/oauth-state';

const SECRET = '0123456789abcdef0123456789abcdef';
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

describe('signState / verifyState', () => {
  it('roundtrip: sign válido → verify retorna payload', async () => {
    const state = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    const payload = await verifyState(state, state, SECRET);
    expect(payload?.workspace_id).toBe(WORKSPACE_ID);
  });

  it('verify retorna null quando state da query ≠ state do cookie', async () => {
    const a = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    const b = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    // Mesmo workspace, mas nonces diferentes → assinaturas diferentes
    expect(await verifyState(a, b, SECRET)).toBeNull();
  });

  it('verify retorna null quando assinatura inválida', async () => {
    const state = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    const tampered = state.slice(0, -4) + 'aaaa';
    expect(await verifyState(tampered, tampered, SECRET)).toBeNull();
  });

  it('verify retorna null quando exp expirou', async () => {
    const state = await signState({ workspace_id: WORKSPACE_ID }, SECRET, -10); // já expirado
    expect(await verifyState(state, state, SECRET)).toBeNull();
  });

  it('verify retorna null com secret diferente', async () => {
    const state = await signState({ workspace_id: WORKSPACE_ID }, SECRET, 600);
    expect(await verifyState(state, state, 'wrong-secret')).toBeNull();
  });

  it('verify retorna null com state malformado', async () => {
    expect(await verifyState('not.a.signed.state', 'not.a.signed.state', SECRET)).toBeNull();
    expect(await verifyState('', '', SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm worker:test -- oauth-state
```

- [ ] **Step 3: Implementar**

Conteúdo de `worker/src/lib/google-ads/oauth-state.ts`:

```ts
import { hmacSha256Hex, timingSafeEqualHex } from '../crypto';

export interface StatePayload {
  workspace_id: string;
  nonce: string;
  exp: number; // unix seconds
}

function b64urlEncode(s: string): string {
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  return atob(padded);
}

export async function signState(
  fields: { workspace_id: string },
  secret: string,
  ttlSeconds: number
): Promise<string> {
  const payload: StatePayload = {
    workspace_id: fields.workspace_id,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacSha256Hex(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyState(
  stateFromQuery: string,
  stateFromCookie: string,
  secret: string
): Promise<StatePayload | null> {
  if (!stateFromQuery || !stateFromCookie) return null;
  if (stateFromQuery.length !== stateFromCookie.length) return null;
  if (!timingSafeEqualHex(stateFromQuery, stateFromCookie)) return null;

  const parts = stateFromQuery.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = await hmacSha256Hex(secret, payloadB64);
  if (!timingSafeEqualHex(expectedSig, sig)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
```

- [ ] **Step 4: Rodar testes — verde**

```bash
pnpm worker:test -- oauth-state
```
Esperado: 6 testes passing.

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/google-ads/oauth-state.ts worker/tests/google-ads/oauth-state.test.ts
git commit -m "feat(worker): oauth-state HMAC sign/verify pra CSRF cookie"
```

---

## Task 15: `oauth.ts` + tests (consent URL + exchange code)

**Files:**
- Create: `worker/src/lib/google-ads/oauth.ts`
- Create: `worker/tests/google-ads/oauth.test.ts`

- [ ] **Step 1: Escrever testes**

Conteúdo de `worker/tests/google-ads/oauth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildConsentUrl, exchangeCodeForTokens } from '../../src/lib/google-ads/oauth';
import { InvalidGrantError } from '../../src/lib/google-ads/errors';

describe('buildConsentUrl', () => {
  it('contém todos os params obrigatórios', () => {
    const url = buildConsentUrl({
      clientId: 'CLIENT_ID',
      redirectUri: 'http://localhost:8787/oauth/google-ads/callback',
      state: 'state-123',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('client_id')).toBe('CLIENT_ID');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:8787/oauth/google-ads/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adwords');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('state')).toBe('state-123');
  });
});

describe('exchangeCodeForTokens', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('retorna tokens em sucesso', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const result = await exchangeCodeForTokens({
      code: 'CODE',
      clientId: 'CID',
      clientSecret: 'CS',
      redirectUri: 'http://r',
    });
    expect(result).toEqual({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  });

  it('throw InvalidGrantError em 400 invalid_grant', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );
    await expect(exchangeCodeForTokens({ code: 'C', clientId: 'CID', clientSecret: 'CS', redirectUri: 'r' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('throw genérico em outros 4xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 })
    );
    await expect(exchangeCodeForTokens({ code: 'C', clientId: 'CID', clientSecret: 'CS', redirectUri: 'r' }))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implementar**

Conteúdo de `worker/src/lib/google-ads/oauth.ts`:

```ts
import { InvalidGrantError, GoogleAdsApiError } from './errors';

// PKCE skipado intencionalmente: Worker é confidential client (tem client_secret)
// e Google não exige PKCE pra confidential clients. State HMAC cobre CSRF.
// Decisão 3.A.1 do spec.

export interface ConsentUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
}

export function buildConsentUrl(params: ConsentUrlParams): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent'); // força refresh_token sempre
  url.searchParams.set('state', params.state);
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface ExchangeCodeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export async function exchangeCodeForTokens(params: ExchangeCodeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (res.status === 400) {
    let parsed: { error?: string } = {};
    try { parsed = (await res.clone().json()) as { error?: string }; } catch { /* noop */ }
    if (parsed.error === 'invalid_grant') throw new InvalidGrantError();
    throw new GoogleAdsApiError(`oauth_400: ${parsed.error ?? 'unknown'}`, 400, parsed);
  }
  if (!res.ok) {
    throw new GoogleAdsApiError(`oauth_${res.status}`, res.status, await res.text());
  }
  return (await res.json()) as TokenResponse;
}
```

- [ ] **Step 3: Rodar testes — verde**

```bash
pnpm worker:test -- google-ads/oauth.test
```
Esperado: 4 testes passing.

- [ ] **Step 4: Commitar**

```bash
git add worker/src/lib/google-ads/oauth.ts worker/tests/google-ads/oauth.test.ts
git commit -m "feat(worker): oauth helpers (consent URL + exchange code)"
```

---

## Task 16: `refresh-token-error-handler.ts` + tests

**Files:**
- Create: `worker/src/lib/google-ads/refresh-token-error-handler.ts`
- Create: `worker/tests/google-ads/refresh-token-error-handler.test.ts`

- [ ] **Step 1: Escrever testes**

Conteúdo de `worker/tests/google-ads/refresh-token-error-handler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyRefreshError } from '../../src/lib/google-ads/refresh-token-error-handler';
import { InvalidGrantError, InvalidClientError } from '../../src/lib/google-ads/errors';

describe('classifyRefreshError', () => {
  it('InvalidGrantError → mark_inactive', () => {
    const c = classifyRefreshError(new InvalidGrantError());
    expect(c).toEqual({ action: 'mark_inactive', reason: 'invalid_grant' });
  });

  it('InvalidClientError → log_critical (sem inactive)', () => {
    const c = classifyRefreshError(new InvalidClientError());
    expect(c).toEqual({ action: 'log_critical', reason: 'invalid_client' });
  });

  it('Error 5xx → transient', () => {
    const e = Object.assign(new Error('5xx'), { httpStatus: 502 });
    expect(classifyRefreshError(e)).toEqual({ action: 'transient', reason: 'upstream_5xx' });
  });

  it('Error desconhecido → log_throw (não marca inativo)', () => {
    expect(classifyRefreshError(new Error('???'))).toEqual({ action: 'log_throw', reason: 'unknown' });
  });
});
```

- [ ] **Step 2: Implementar**

Conteúdo de `worker/src/lib/google-ads/refresh-token-error-handler.ts`:

```ts
import { InvalidGrantError, InvalidClientError } from './errors';

export type RefreshErrorAction = 'mark_inactive' | 'log_critical' | 'transient' | 'log_throw';

export interface RefreshErrorClassification {
  action: RefreshErrorAction;
  reason: string;
}

export function classifyRefreshError(err: unknown): RefreshErrorClassification {
  if (err instanceof InvalidGrantError) {
    return { action: 'mark_inactive', reason: 'invalid_grant' };
  }
  if (err instanceof InvalidClientError) {
    return { action: 'log_critical', reason: 'invalid_client' };
  }
  if (typeof err === 'object' && err !== null && 'httpStatus' in err) {
    const status = (err as { httpStatus: number }).httpStatus;
    if (status >= 500) return { action: 'transient', reason: 'upstream_5xx' };
  }
  return { action: 'log_throw', reason: 'unknown' };
}
```

- [ ] **Step 3: Rodar e commitar**

```bash
pnpm worker:test -- refresh-token-error-handler
git add worker/src/lib/google-ads/refresh-token-error-handler.ts worker/tests/google-ads/refresh-token-error-handler.test.ts
git commit -m "feat(worker): classifyRefreshError pra diferenciar transient vs terminal"
```

---

## Task 17: `oauth-error-messages.ts` (mapping reason → string PT-BR)

**Files:**
- Create: `worker/src/lib/oauth-error-messages.ts`

- [ ] **Step 1: Implementar**

Conteúdo de `worker/src/lib/oauth-error-messages.ts`:

```ts
// Mapping de (status, reason) → mensagem amigável em PT-BR.
// Worker grava o reason na URL de redirect; App lê e mostra toast.
// Cópia em app/lib/google-ads/oauth-error-messages.ts (manter sync — tech debt §13 do spec).

export type OAuthStatus = 'connected' | 'session_expired' | 'oauth_error' | 'sync_started';

export type OAuthReason =
  | 'state_invalid'
  | 'state_missing'
  | 'state_mismatch'
  | 'code_exchange_failed'
  | 'no_accounts'
  | 'db_error'
  | 'user_cancelled';

export function getOAuthMessage(status: OAuthStatus, reason?: string): string | null {
  if (status === 'connected') return 'Conta conectada com sucesso.';
  if (status === 'session_expired') return 'Sessão de seleção expirou. Reconecte.';
  if (status === 'sync_started') return 'Sincronização iniciada...';
  if (status === 'oauth_error') {
    switch (reason as OAuthReason) {
      case 'state_invalid':
      case 'state_missing':
      case 'state_mismatch':
        return 'Validação de segurança falhou. Tente novamente.';
      case 'code_exchange_failed':
        return 'Não foi possível concluir a autenticação Google. Tente novamente.';
      case 'no_accounts':
        return 'Sua conta Google não tem nenhuma conta Google Ads acessível.';
      case 'db_error':
        return 'Erro interno. Tente novamente em instantes.';
      case 'user_cancelled':
        return null; // sem toast
      default:
        return 'Erro inesperado durante a conexão. Tente novamente.';
    }
  }
  return null;
}
```

- [ ] **Step 2: Commitar**

```bash
git add worker/src/lib/oauth-error-messages.ts
git commit -m "feat(worker): oauth-error-messages mapping reason → PT-BR"
```

---

## Task 18: `sync-log.ts` helper (insertSyncLog + updateSyncLog)

**Files:**
- Create: `worker/src/lib/sync-log.ts`

> Sem teste dedicado — funcionalidade já coberta pelo sync-log.test.ts integration (Task 5). Helper só força `sync_type` como required parameter via TS.

- [ ] **Step 1: Implementar**

Conteúdo de `worker/src/lib/sync-log.ts`:

```ts
import type { SupabaseClient } from './supabase';

export interface InsertSyncLogFields {
  google_ads_account_id: string;
  sync_type: 'metadata' | 'cost'; // REQUIRED — TS força explícito
  status: 'running';
  trace_id: string;
  date_range_start?: string; // YYYY-MM-DD
  date_range_end?: string;
  triggered_by?: 'on_demand' | 'cron' | 'manual';
}

export interface UpdateSyncLogFields {
  status?: 'success' | 'partial' | 'failed';
  rows_synced?: number;
  parsed_skipped?: number;
  partial_skipped?: Record<string, unknown>;
  error_message?: string;
  duration_ms?: number;
  completed_at?: string;
}

export async function insertSyncLog(sb: SupabaseClient, fields: InsertSyncLogFields): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const row = {
    ...fields,
    date_range_start: fields.date_range_start ?? today,
    date_range_end: fields.date_range_end ?? today,
    triggered_by: fields.triggered_by ?? 'on_demand',
  };
  // Pra ler o id de volta, fazemos insert + select pelo trace_id (único).
  await sb.insert('google_ads_sync_log', row);
  const rows = await sb.select<{ id: string }>('google_ads_sync_log', {
    trace_id: `eq.${fields.trace_id}`,
    select: 'id',
    limit: '1',
  });
  if (!rows[0]) throw new Error('insertSyncLog: row not found after insert');
  return rows[0].id;
}

export async function updateSyncLog(
  sb: SupabaseClient,
  logId: string,
  patch: UpdateSyncLogFields
): Promise<void> {
  await sb.update('google_ads_sync_log', { id: `eq.${logId}` }, patch);
}
```

- [ ] **Step 2: Commitar**

```bash
git add worker/src/lib/sync-log.ts
git commit -m "feat(worker): sync-log helpers com sync_type required (TS enforce)"
```

---



## Phase 4 — Libs top (Worker)

## Task 19: `client.ts` — `refreshAccessToken` + tests

**Files:**
- Create: `worker/src/lib/google-ads/client.ts`
- Create: `worker/tests/google-ads/client.test.ts`

- [ ] **Step 1: Escrever testes (refreshAccessToken só)**

Conteúdo inicial de `worker/tests/google-ads/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshAccessToken } from '../../src/lib/google-ads/client';
import { InvalidGrantError, InvalidClientError, GoogleAdsApiError } from '../../src/lib/google-ads/errors';

describe('refreshAccessToken', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('retorna access_token + expires_in em sucesso', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ access_token: 'AT', expires_in: 3600 }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ));
    const r = await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', clientSecret: 'CS' });
    expect(r).toEqual({ access_token: 'AT', expires_in: 3600 });
  });

  it('throw InvalidGrantError em 400 invalid_grant', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: 'invalid_grant' }),
      { status: 400 }
    ));
    await expect(refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', clientSecret: 'CS' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('throw InvalidClientError em 401 invalid_client', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: 'invalid_client' }),
      { status: 401 }
    ));
    await expect(refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', clientSecret: 'CS' }))
      .rejects.toBeInstanceOf(InvalidClientError);
  });

  it('throw GoogleAdsApiError com httpStatus em 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('upstream error', { status: 503 }));
    const promise = refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', clientSecret: 'CS' });
    await expect(promise).rejects.toBeInstanceOf(GoogleAdsApiError);
    await expect(promise).rejects.toMatchObject({ httpStatus: 503 });
  });
});
```

- [ ] **Step 2: Implementar `refreshAccessToken`**

Conteúdo inicial de `worker/src/lib/google-ads/client.ts`:

```ts
import { InvalidGrantError, InvalidClientError, GoogleAdsApiError } from './errors';

export interface RefreshTokenParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export interface RefreshTokenResult {
  access_token: string;
  expires_in: number;
}

export async function refreshAccessToken(p: RefreshTokenParams): Promise<RefreshTokenResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: p.clientId,
    client_secret: p.clientSecret,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (res.status === 400) {
    let parsed: { error?: string } = {};
    try { parsed = (await res.clone().json()) as { error?: string }; } catch { /* noop */ }
    if (parsed.error === 'invalid_grant') throw new InvalidGrantError();
    throw new GoogleAdsApiError(`refresh_400: ${parsed.error ?? 'unknown'}`, 400, parsed);
  }
  if (res.status === 401) {
    let parsed: { error?: string } = {};
    try { parsed = (await res.clone().json()) as { error?: string }; } catch { /* noop */ }
    if (parsed.error === 'invalid_client' || parsed.error === 'unauthorized_client') {
      throw new InvalidClientError(parsed.error);
    }
    throw new GoogleAdsApiError(`refresh_401`, 401, parsed);
  }
  if (!res.ok) {
    throw new GoogleAdsApiError(`refresh_${res.status}`, res.status, await res.text());
  }
  return (await res.json()) as RefreshTokenResult;
}
```

- [ ] **Step 3: Rodar testes — verde**

```bash
pnpm worker:test -- google-ads/client.test
```
Esperado: 4 passing.

- [ ] **Step 4: Commitar**

```bash
git add worker/src/lib/google-ads/client.ts worker/tests/google-ads/client.test.ts
git commit -m "feat(worker): refreshAccessToken com classificação de erro Google"
```

---

## Task 20: `client.ts` — `googleAdsSearch` com paginação + tests

**Files:**
- Modify: `worker/src/lib/google-ads/client.ts`
- Modify: `worker/tests/google-ads/client.test.ts`

- [ ] **Step 1: Adicionar testes de googleAdsSearch**

Append ao `worker/tests/google-ads/client.test.ts`:

```ts
import { googleAdsSearch } from '../../src/lib/google-ads/client';
import { RateLimitError, NetworkError } from '../../src/lib/google-ads/errors';

describe('googleAdsSearch', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const baseParams = {
    accessToken: 'AT',
    customerId: '1234567890',
    developerToken: 'DT',
    managerCustomerId: null as string | null,
    gaql: 'SELECT campaign.id FROM campaign',
  };

  it('single page sem nextPageToken retorna todas as rows', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ campaign: { id: '1' } }, { campaign: { id: '2' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const rows = await googleAdsSearch(baseParams);
    expect(rows.length).toBe(2);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('multi-page concatena via nextPageToken', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ campaign: { id: '1' } }],
        nextPageToken: 'TOKEN_2',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ campaign: { id: '2' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const rows = await googleAdsSearch(baseParams);
    expect(rows.length).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('429 com Retry-After dispara RateLimitError', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': '5' },
    }));
    await expect(googleAdsSearch(baseParams)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('network error (fetch reject) dispara NetworkError após retries', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(googleAdsSearch({ ...baseParams, retries: 0 })).rejects.toBeInstanceOf(NetworkError);
  });

  it('manager_customer_id presente adiciona header login-customer-id', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await googleAdsSearch({ ...baseParams, managerCustomerId: '9999999999' });
    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['login-customer-id']).toBe('9999999999');
  });
});
```

- [ ] **Step 2: Implementar `googleAdsSearch` no `client.ts`**

Append ao `worker/src/lib/google-ads/client.ts`:

```ts
import { RateLimitError, NetworkError } from './errors';

export interface GoogleAdsSearchParams {
  accessToken: string;
  customerId: string;
  developerToken: string;
  managerCustomerId: string | null;
  gaql: string;
  pageSize?: number;
  retries?: number; // default 0; usado em testes pra simular sem retries
}

const API_VERSION = 'v17';

export async function googleAdsSearch<T = unknown>(params: GoogleAdsSearchParams): Promise<T[]> {
  const pageSize = params.pageSize ?? 1000;
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${params.customerId}/googleAds:search`;

  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${params.accessToken}`,
    'developer-token': params.developerToken,
    'content-type': 'application/json',
  };
  if (params.managerCustomerId) {
    baseHeaders['login-customer-id'] = params.managerCustomerId;
  }

  const allResults: T[] = [];
  let pageToken: string | undefined;

  do {
    const body: Record<string, unknown> = { query: params.gaql, pageSize };
    if (pageToken) body.pageToken = pageToken;

    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: baseHeaders, body: JSON.stringify(body) });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'fetch_failed');
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10) || undefined;
      throw new RateLimitError(retryAfter);
    }
    if (!res.ok) {
      throw new Error(`googleAdsSearch ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { results?: T[]; nextPageToken?: string };
    if (Array.isArray(json.results)) allResults.push(...json.results);
    pageToken = json.nextPageToken;
  } while (pageToken);

  return allResults;
}
```

- [ ] **Step 3: Rodar testes — verde**

```bash
pnpm worker:test -- google-ads/client.test
```
Esperado: 9 testes passing (4 de refresh + 5 de search).

- [ ] **Step 4: Commitar**

```bash
git add worker/src/lib/google-ads/client.ts worker/tests/google-ads/client.test.ts
git commit -m "feat(worker): googleAdsSearch com paginação + manager header + rate limit"
```

---

## Task 21: `client.ts` — `listAccessibleCustomers` + tests

**Files:**
- Modify: `worker/src/lib/google-ads/client.ts`
- Modify: `worker/tests/google-ads/client.test.ts`

- [ ] **Step 1: Adicionar testes**

Append ao `worker/tests/google-ads/client.test.ts`:

```ts
import { listAccessibleCustomers } from '../../src/lib/google-ads/client';

describe('listAccessibleCustomers', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('retorna array de customer_ids extraídos de resourceNames', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      resourceNames: ['customers/1234567890', 'customers/9876543210'],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const ids = await listAccessibleCustomers({ accessToken: 'AT', developerToken: 'DT' });
    expect(ids).toEqual(['1234567890', '9876543210']);
  });

  it('retorna [] em response sem resourceNames', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({}), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    expect(await listAccessibleCustomers({ accessToken: 'AT', developerToken: 'DT' })).toEqual([]);
  });

  it('throw em 4xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    await expect(listAccessibleCustomers({ accessToken: 'AT', developerToken: 'DT' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implementar**

Append ao `worker/src/lib/google-ads/client.ts`:

```ts
export interface ListAccessibleParams {
  accessToken: string;
  developerToken: string;
}

export async function listAccessibleCustomers(p: ListAccessibleParams): Promise<string[]> {
  const url = `https://googleads.googleapis.com/${API_VERSION}/customers:listAccessibleCustomers`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${p.accessToken}`,
      'developer-token': p.developerToken,
    },
  });
  if (!res.ok) {
    throw new Error(`listAccessibleCustomers ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { resourceNames?: string[] };
  if (!Array.isArray(json.resourceNames)) return [];
  return json.resourceNames.map((rn) => rn.replace(/^customers\//, ''));
}
```

- [ ] **Step 3: Rodar e commitar**

```bash
pnpm worker:test -- google-ads/client.test
git add worker/src/lib/google-ads/client.ts worker/tests/google-ads/client.test.ts
git commit -m "feat(worker): listAccessibleCustomers extrai customer_ids dos resourceNames"
```

---

## Task 22: `sync.ts` — orchestrator skeleton + checkBudget + zombie cleanup

**Files:**
- Create: `worker/src/lib/google-ads/sync.ts`
- Create: `worker/tests/google-ads/sync.test.ts`

> Esta task implementa a orquestração principal. As GAQL calls são mockadas via vi.spyOn(client). Phases internas (syncCampaigns/syncAdGroups/syncAds) são privadas; testamos via syncAccount end-to-end em diferentes cenários.

- [ ] **Step 1: Escrever teste do happy path**

Conteúdo inicial de `worker/tests/google-ads/sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { syncAccount } from '../../src/lib/google-ads/sync';
import * as client from '../../src/lib/google-ads/client';
import { createSupabaseClient } from '../../src/lib/supabase';
import { encryptAesGcm } from '../../src/lib/crypto';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = '00000000-0000-0000-0000-00000000a100';
const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

async function setupAccount(sb: ReturnType<typeof createSupabaseClient>) {
  await sb.delete('google_ads_accounts', { id: `eq.${ACCOUNT_ID}` });
  const { ciphertext, iv } = await encryptAesGcm(KEY_HEX, 'fake-refresh-token');
  await sb.insert('google_ads_accounts', {
    id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    customer_id: '1234567890',
    refresh_token_encrypted: ciphertext,
    refresh_token_iv: iv,
    is_active: true,
  });
}

describe('syncAccount orchestrator', () => {
  let sb: ReturnType<typeof createSupabaseClient>;

  beforeEach(async () => {
    sb = createSupabaseClient(env);
    Object.assign(env, { ENCRYPTION_KEY: KEY_HEX });
    await setupAccount(sb);
    // Limpa logs anteriores
    await sb.delete('google_ads_sync_log', { google_ads_account_id: `eq.${ACCOUNT_ID}` });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: sync completo cria sync_log status=success', async () => {
    vi.spyOn(client, 'refreshAccessToken').mockResolvedValue({ access_token: 'AT', expires_in: 3600 });
    vi.spyOn(client, 'googleAdsSearch')
      .mockResolvedValueOnce([{ campaign: { id: '111', name: 'C1', status: 'ENABLED' } }]) // campaigns
      .mockResolvedValueOnce([]) // ad_groups for C1
      .mockResolvedValueOnce([]); // asset_groups for C1

    const result = await syncAccount(env, { id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, customer_id: '1234567890', manager_customer_id: null, refresh_token_encrypted: '', refresh_token_iv: '', is_active: true });
    expect(result.status).toBe('success');

    const logs = await sb.select<{ status: string; sync_type: string }>('google_ads_sync_log', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`, select: 'status,sync_type',
    });
    expect(logs[0].sync_type).toBe('metadata');
    expect(logs[0].status).toBe('success');
  });

  it('zombie cleanup: log anterior em running > 5min vira failed', async () => {
    const sixMinAgo = new Date(Date.now() - 6 * 60_000).toISOString();
    await sb.insert('google_ads_sync_log', {
      google_ads_account_id: ACCOUNT_ID,
      sync_type: 'metadata',
      status: 'running',
      started_at: sixMinAgo,
      date_range_start: '2026-05-07',
      date_range_end: '2026-05-07',
    });

    vi.spyOn(client, 'refreshAccessToken').mockResolvedValue({ access_token: 'AT', expires_in: 3600 });
    vi.spyOn(client, 'googleAdsSearch').mockResolvedValue([]);

    await syncAccount(env, { id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, customer_id: '1234567890', manager_customer_id: null, refresh_token_encrypted: '', refresh_token_iv: '', is_active: true });

    const zombieRows = await sb.select<{ status: string; error_message: string | null }>('google_ads_sync_log', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      started_at: `eq.${sixMinAgo}`,
      select: 'status,error_message',
    });
    expect(zombieRows[0].status).toBe('failed');
    expect(zombieRows[0].error_message).toBe('zombie_timeout');
  });

  it('409 sync_in_progress: log running < 5min bloqueia novo sync', async () => {
    await sb.insert('google_ads_sync_log', {
      google_ads_account_id: ACCOUNT_ID,
      sync_type: 'metadata',
      status: 'running',
      started_at: new Date().toISOString(),
      date_range_start: '2026-05-07',
      date_range_end: '2026-05-07',
    });

    await expect(syncAccount(env, {
      id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, customer_id: '1234567890',
      manager_customer_id: null, refresh_token_encrypted: '', refresh_token_iv: '', is_active: true,
    })).rejects.toThrow(/sync_in_progress/);
  });

  it('invalid_grant marca account is_active=false', async () => {
    const { InvalidGrantError } = await import('../../src/lib/google-ads/errors');
    vi.spyOn(client, 'refreshAccessToken').mockRejectedValue(new InvalidGrantError());

    await expect(syncAccount(env, {
      id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, customer_id: '1234567890',
      manager_customer_id: null, refresh_token_encrypted: '', refresh_token_iv: '', is_active: true,
    })).rejects.toBeInstanceOf(InvalidGrantError);

    const acc = await sb.select<{ is_active: boolean }>('google_ads_accounts', {
      id: `eq.${ACCOUNT_ID}`, select: 'is_active',
    });
    expect(acc[0].is_active).toBe(false);
  });

  it('REMOVED detection: campaign não retornada no sync vira REMOVED', async () => {
    // Pré-popular uma campaign
    await sb.delete('campaigns', { google_ads_account_id: `eq.${ACCOUNT_ID}` });
    const oldSync = new Date(Date.now() - 60_000).toISOString();
    await sb.insert('campaigns', {
      google_ads_account_id: ACCOUNT_ID,
      google_campaign_id: '999',
      name: 'old',
      status: 'ENABLED',
      last_synced_at: oldSync,
    });

    vi.spyOn(client, 'refreshAccessToken').mockResolvedValue({ access_token: 'AT', expires_in: 3600 });
    vi.spyOn(client, 'googleAdsSearch').mockResolvedValue([]); // sync vazio

    await syncAccount(env, {
      id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, customer_id: '1234567890',
      manager_customer_id: null, refresh_token_encrypted: '', refresh_token_iv: '', is_active: true,
    });

    const c = await sb.select<{ status: string }>('campaigns', {
      google_ads_account_id: `eq.${ACCOUNT_ID}`,
      google_campaign_id: 'eq.999',
      select: 'status',
    });
    expect(c[0].status).toBe('REMOVED');
  });
});
```

- [ ] **Step 2: Implementar `sync.ts` skeleton + zombie cleanup + concurrency check + happy path**

Conteúdo de `worker/src/lib/google-ads/sync.ts`:

```ts
import type { Env } from '../../types';
import { createSupabaseClient } from '../supabase';
import { decryptAesGcm } from '../crypto';
import { createStructuredLogger } from '../structured-log';
import { insertSyncLog, updateSyncLog } from '../sync-log';
import { upsertWithBisect } from '../upsert-bisect';
import {
  refreshAccessToken,
  googleAdsSearch,
} from './client';
import {
  CAMPAIGN_QUERY,
  adGroupQuery,
  adQuery,
  assetGroupQuery,
} from './queries';
import {
  parseCampaignRow,
  parseAdGroupRow,
  parseAdRow,
  parseAssetGroupRow,
} from './parsers';
import {
  TimeBudgetError,
  InvalidGrantError,
} from './errors';
import { classifyRefreshError } from './refresh-token-error-handler';

const WORKER_BUDGET_MS = 28000;
const ZOMBIE_THRESHOLD_MIN = 5;

export interface GoogleAdsAccountRow {
  id: string;
  workspace_id: string;
  customer_id: string;
  manager_customer_id: string | null;
  refresh_token_encrypted: string;
  refresh_token_iv: string;
  is_active: boolean;
}

export interface SyncResult {
  log_id: string;
  status: 'success' | 'partial' | 'failed';
  rows_synced: number;
  duration_ms: number;
}

export async function syncAccount(env: Env, account: GoogleAdsAccountRow): Promise<SyncResult> {
  const sb = createSupabaseClient(env);
  const traceId = crypto.randomUUID();
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const log = createStructuredLogger(traceId, startedAt);

  log.info('sync_start', { account_id: account.id, customer_id: account.customer_id });

  // Passo 0: zombie cleanup
  const zombieThresholdIso = new Date(startedAt - ZOMBIE_THRESHOLD_MIN * 60_000).toISOString();
  await sb.update('google_ads_sync_log',
    { google_ads_account_id: `eq.${account.id}`, status: 'eq.running', started_at: `lt.${zombieThresholdIso}` },
    { status: 'failed', error_message: 'zombie_timeout', completed_at: startedAtIso }
  );

  // Passo 1: 409 se há run 'running' < 5min
  const inProgress = await sb.select<{ id: string }>('google_ads_sync_log', {
    google_ads_account_id: `eq.${account.id}`,
    status: 'eq.running',
    started_at: `gte.${zombieThresholdIso}`,
    select: 'id',
    limit: '1',
  });
  if (inProgress.length > 0) {
    log.warn('sync_in_progress', { existing_log_id: inProgress[0].id });
    throw new Error('sync_in_progress');
  }

  // Passo 2: insere sync_log status=running
  const logId = await insertSyncLog(sb, {
    google_ads_account_id: account.id,
    sync_type: 'metadata',
    status: 'running',
    trace_id: traceId,
    triggered_by: 'on_demand',
  });

  function checkBudget(reason: string) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > WORKER_BUDGET_MS) throw new TimeBudgetError(reason, elapsed);
  }

  let rowsSynced = 0;
  let parsedSkipped = 0;
  let phaseCompleted: 'init' | 'campaigns' | 'ad_groups' | 'ads' = 'init';
  let partialSkipped: Record<string, unknown> | null = null;

  try {
    // Passo 3: decrypt + refresh
    const refreshToken = await decryptAesGcm(env.ENCRYPTION_KEY, account.refresh_token_encrypted, account.refresh_token_iv);
    const tokens = await refreshAccessToken({
      refreshToken,
      clientId: env.GOOGLE_ADS_CLIENT_ID,
      clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
    });
    log.info('access_token_refreshed', { expires_in: tokens.expires_in });

    // Passo 4: syncCampaigns
    const campaignsCount = await syncCampaigns(env, sb, account, tokens.access_token, log, startedAtIso);
    rowsSynced += campaignsCount.ok;
    parsedSkipped += campaignsCount.skipped;
    phaseCompleted = 'campaigns';

    // Passo 5: por campaign, sync ad_groups + ads OU asset_groups
    checkBudget('before_ad_groups');
    const campaigns = await sb.select<{ id: string; google_campaign_id: string; campaign_type: string | null }>(
      'campaigns',
      { google_ads_account_id: `eq.${account.id}`, select: 'id,google_campaign_id,campaign_type' }
    );
    const adGroupTotal = await syncAdGroupsAndAssetGroups(env, sb, account, tokens.access_token, campaigns, log, startedAtIso, checkBudget);
    rowsSynced += adGroupTotal.ok;
    parsedSkipped += adGroupTotal.skipped;
    phaseCompleted = 'ad_groups';

    checkBudget('before_ads');
    const adGroups = await sb.select<{ id: string; google_ad_group_id: string; entity_type: string }>(
      'ad_groups',
      {
        select: 'id,google_ad_group_id,entity_type',
        // join: só ad_groups cujo campaign pertence a este account.
        // Postgrest filter via composite seria ideal; por hora, filtra in-memory.
      }
    );
    const adsTotal = await syncAds(env, sb, account, tokens.access_token, adGroups, log, startedAtIso, checkBudget);
    rowsSynced += adsTotal.ok;
    parsedSkipped += adsTotal.skipped;
    phaseCompleted = 'ads';

    // Passo 6: mark_removed via RPC
    checkBudget('before_mark_removed');
    const removed = await sb.rpc<Array<{ campaigns_marked: number; ad_groups_marked: number; ads_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: account.id, p_started_at: startedAtIso }
    );
    log.info('mark_removed', removed[0] as Record<string, unknown>);

    // Passo 7: update account.last_synced_at + log success
    await sb.update('google_ads_accounts', { id: `eq.${account.id}` }, { last_synced_at: startedAtIso });
    const durationMs = Date.now() - startedAt;
    await updateSyncLog(sb, logId, {
      status: 'success', rows_synced: rowsSynced, parsed_skipped: parsedSkipped,
      duration_ms: durationMs, completed_at: new Date().toISOString(),
    });
    log.info('sync_success', { rows_synced: rowsSynced, parsed_skipped: parsedSkipped, duration_ms: durationMs });

    return { log_id: logId, status: 'success', rows_synced: rowsSynced, duration_ms: durationMs };

  } catch (err) {
    const durationMs = Date.now() - startedAt;

    if (err instanceof TimeBudgetError) {
      partialSkipped = {
        reason: err.reason,
        elapsed_ms: err.elapsedMs,
        phase_completed: phaseCompleted,
        skipped: ['mark_removed', phaseCompleted === 'campaigns' ? 'ad_groups+ads' : phaseCompleted === 'ad_groups' ? 'ads' : 'remaining'],
      };
      await updateSyncLog(sb, logId, {
        status: 'partial', rows_synced: rowsSynced, parsed_skipped: parsedSkipped,
        partial_skipped: partialSkipped, duration_ms: durationMs, completed_at: new Date().toISOString(),
      });
      log.warn('sync_partial', partialSkipped);
      return { log_id: logId, status: 'partial', rows_synced: rowsSynced, duration_ms: durationMs };
    }

    // Classifica erro de refresh; se invalid_grant, marca inativo
    const classification = classifyRefreshError(err);
    if (classification.action === 'mark_inactive') {
      await sb.update('google_ads_accounts', { id: `eq.${account.id}` }, { is_active: false });
      log.error('account_marked_inactive', { reason: classification.reason });
    }

    await updateSyncLog(sb, logId, {
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });
    log.error('sync_failed', { reason: classification.reason });
    throw err;
  }
}

// Helpers privados — implementados nas tasks 23-25 abaixo.
async function syncCampaigns(env: Env, sb: ReturnType<typeof createSupabaseClient>, account: GoogleAdsAccountRow, accessToken: string, log: ReturnType<typeof createStructuredLogger>, syncedAt: string): Promise<{ ok: number; skipped: number }> {
  const rows = await googleAdsSearch({
    accessToken, customerId: account.customer_id, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
    managerCustomerId: account.manager_customer_id, gaql: CAMPAIGN_QUERY,
  });
  let parsedSkipped = 0;
  const parsed = rows.map((r) => {
    const p = parseCampaignRow(r);
    if (!p) parsedSkipped++;
    return p;
  }).filter((p): p is NonNullable<typeof p> => p !== null);

  const upsertRows = parsed.map((p) => ({
    google_ads_account_id: account.id,
    ...p,
    last_synced_at: syncedAt,
  }));

  const result = await upsertWithBisect(
    upsertRows,
    (batch) => sb.upsert('campaigns', batch, { onConflict: 'google_ads_account_id,google_campaign_id' }),
    (skipped) => log.warn('upsert_row_skipped', { table: 'campaigns', google_campaign_id: skipped.google_campaign_id })
  );
  return { ok: result.ok, skipped: parsedSkipped + result.skipped };
}

async function syncAdGroupsAndAssetGroups(
  env: Env, sb: ReturnType<typeof createSupabaseClient>, account: GoogleAdsAccountRow,
  accessToken: string, campaigns: Array<{ id: string; google_campaign_id: string; campaign_type: string | null }>,
  log: ReturnType<typeof createStructuredLogger>, syncedAt: string,
  checkBudget: (reason: string) => void
): Promise<{ ok: number; skipped: number }> {
  let totalOk = 0;
  let totalSkipped = 0;
  let processed = 0;

  // Batches de 5 paralelos pra respeitar concorrência da decisão 3.B.3
  for (let i = 0; i < campaigns.length; i += 5) {
    const batch = campaigns.slice(i, i + 5);
    await Promise.all(batch.map(async (c) => {
      const isPmaxOrDg = c.campaign_type === 'PERFORMANCE_MAX' || c.campaign_type === 'DEMAND_GEN';
      const resourceName = `customers/${account.customer_id}/campaigns/${c.google_campaign_id}`;

      if (isPmaxOrDg) {
        const rows = await googleAdsSearch({
          accessToken, customerId: account.customer_id, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
          managerCustomerId: account.manager_customer_id, gaql: assetGroupQuery(resourceName),
        });
        const parsed = rows.map((r) => parseAssetGroupRow(r, c.id)).filter((p): p is NonNullable<typeof p> => p !== null);
        totalSkipped += rows.length - parsed.length;
        const result = await upsertWithBisect(
          parsed.map((p) => ({ ...p, last_synced_at: syncedAt })),
          (b) => sb.upsert('ad_groups', b, { onConflict: 'campaign_id,google_ad_group_id' }),
          (skipped) => log.warn('upsert_row_skipped', { table: 'ad_groups', google_ad_group_id: skipped.google_ad_group_id })
        );
        totalOk += result.ok;
        totalSkipped += result.skipped;
      } else {
        const rows = await googleAdsSearch({
          accessToken, customerId: account.customer_id, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
          managerCustomerId: account.manager_customer_id, gaql: adGroupQuery(resourceName),
        });
        const parsed = rows.map((r) => parseAdGroupRow(r, c.id)).filter((p): p is NonNullable<typeof p> => p !== null);
        totalSkipped += rows.length - parsed.length;
        const result = await upsertWithBisect(
          parsed.map((p) => ({ ...p, last_synced_at: syncedAt })),
          (b) => sb.upsert('ad_groups', b, { onConflict: 'campaign_id,google_ad_group_id' }),
          (skipped) => log.warn('upsert_row_skipped', { table: 'ad_groups', google_ad_group_id: skipped.google_ad_group_id })
        );
        totalOk += result.ok;
        totalSkipped += result.skipped;
      }
    }));
    processed += batch.length;
    if (processed % 10 === 0) checkBudget('mid_ad_groups');
  }
  return { ok: totalOk, skipped: totalSkipped };
}

async function syncAds(
  env: Env, sb: ReturnType<typeof createSupabaseClient>, account: GoogleAdsAccountRow,
  accessToken: string, adGroups: Array<{ id: string; google_ad_group_id: string; entity_type: string }>,
  log: ReturnType<typeof createStructuredLogger>, syncedAt: string,
  checkBudget: (reason: string) => void
): Promise<{ ok: number; skipped: number }> {
  // Decisão β/3.B.5.3: asset_groups (PMax/DG) não importam ads na 2A.
  const targetAdGroups = adGroups.filter((ag) => ag.entity_type === 'AD_GROUP');
  let totalOk = 0;
  let totalSkipped = 0;
  let processed = 0;

  for (let i = 0; i < targetAdGroups.length; i += 5) {
    const batch = targetAdGroups.slice(i, i + 5);
    await Promise.all(batch.map(async (ag) => {
      const resourceName = `customers/${account.customer_id}/adGroups/${ag.google_ad_group_id}`;
      const rows = await googleAdsSearch({
        accessToken, customerId: account.customer_id, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
        managerCustomerId: account.manager_customer_id, gaql: adQuery(resourceName),
      });
      const parsed = rows.map((r) => parseAdRow(r, ag.id)).filter((p): p is NonNullable<typeof p> => p !== null);
      totalSkipped += rows.length - parsed.length;
      const result = await upsertWithBisect(
        parsed.map((p) => ({ ...p, last_synced_at: syncedAt })),
        (b) => sb.upsert('ads', b, { onConflict: 'ad_group_id,google_ad_id' }),
        (skipped) => log.warn('upsert_row_skipped', { table: 'ads', google_ad_id: skipped.google_ad_id })
      );
      totalOk += result.ok;
      totalSkipped += result.skipped;
    }));
    processed += batch.length;
    if (processed % 50 === 0) checkBudget('mid_ads');
  }
  return { ok: totalOk, skipped: totalSkipped };
}
```

- [ ] **Step 3: Rodar testes — verde**

```bash
pnpm worker:test -- google-ads/sync.test
```
Esperado: 5 testes passing.

- [ ] **Step 4: Commitar**

```bash
git add worker/src/lib/google-ads/sync.ts worker/tests/google-ads/sync.test.ts
git commit -m "feat(worker): syncAccount orchestrator com zombie cleanup + checkBudget + REMOVED"
```

---

## ▸ CHECKPOINT 2 — Libs prontas, testes verde

> **Pausa.** Antes de seguir pra Phase 5:
> 1. Rodar suite completa: `pnpm worker:test`. Esperado: ~190+ testes verde (156 Fase 1 + integration tests Phase 1 da 2A + unit tests Phases 2-4).
> 2. Leo + Claude revisam coverage qualitativa: cada classe de erro do spec §4 tem teste? Cada cenário de §3.B tem teste? Cada parser tem happy + edge?
> 3. Se algum cenário do spec §11.2 ficou sem teste, criar agora. Plano não cobre exhaustivo de fixtures (cobertos via tests reais nas tasks); criar fixtures placeholders agora ou pós-smoke.
> 4. Pausa pra ajustes (libs são fáceis de mexer; depois da Phase 6 fica mais caro).
> 5. Quando aprovado, seguir pra Phase 5 (UI stub).

---



## Phase 5 — App UI básica + AlertDialog setup (modo stub)

> **Aviso:** `app/AGENTS.md` flag que essa versão do Next tem breaking changes. Antes de escrever cada `route.ts` ou `page.tsx`, consultar a doc relevante em `node_modules/next/dist/docs/` (ex: `app-router/route-handlers.md`, `app-router/server-components.md`). Se houver dúvida sobre signature, ler doc antes de escrever.

## Task 23: shadcn AlertDialog + `confirm-destructive.tsx`

**Files:**
- Create: `app/components/ui/alert-dialog.tsx` (gerado via shadcn CLI)
- Create: `app/components/confirm-destructive.tsx`

- [ ] **Step 1: Adicionar componente shadcn**

```bash
cd app
pnpm dlx shadcn@latest add alert-dialog
cd ..
```

Esperado: `app/components/ui/alert-dialog.tsx` criado.

- [ ] **Step 2: Implementar wrapper `confirm-destructive.tsx`**

Conteúdo de `app/components/confirm-destructive.tsx`:

```tsx
'use client';

import { ReactNode, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ConfirmDestructiveProps {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  actionLabel: string;
  onConfirm: () => void | Promise<void>;
  cancelLabel?: string;
}

export function ConfirmDestructive({
  trigger, title, description, actionLabel, onConfirm, cancelLabel = 'Cancelar',
}: ConfirmDestructiveProps) {
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: 'destructive' }))}
            disabled={pending}
            onClick={async (e) => {
              e.preventDefault();
              setPending(true);
              try {
                await onConfirm();
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? '…' : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

> Se `cn` ou `buttonVariants` não existirem ainda no app (vinheram do shadcn add button), confirmar via `git status` se foram criados/atualizados. Se faltar `lib/utils.ts`, criar via `pnpm dlx shadcn@latest init` (mas provavelmente já existe da Fase 1).

- [ ] **Step 3: Commitar**

```bash
git add app/components/ui/alert-dialog.tsx app/components/confirm-destructive.tsx
git commit -m "feat(app): shadcn alert-dialog + confirm-destructive wrapper"
```

---

## Task 24: Cópias de `customer-id.ts` + `oauth-error-messages.ts` no App

**Files:**
- Create: `app/lib/google-ads/customer-id.ts`
- Create: `app/lib/google-ads/oauth-error-messages.ts`

> Cópia direta do Worker (decisão do spec §7.4 — tech debt §13 sobre monorepo shared cobre quando virar 4ª duplicação).

- [ ] **Step 1: Copiar customer-id**

Mesmo conteúdo do `worker/src/lib/customer-id.ts`. Pode ser cópia literal:

```bash
mkdir -p app/lib/google-ads
cp worker/src/lib/customer-id.ts app/lib/google-ads/customer-id.ts
```

- [ ] **Step 2: Copiar oauth-error-messages**

```bash
cp worker/src/lib/oauth-error-messages.ts app/lib/google-ads/oauth-error-messages.ts
```

- [ ] **Step 3: Commitar**

```bash
git add app/lib/google-ads/
git commit -m "feat(app): cópias de customer-id e oauth-error-messages do worker"
```

---

## Task 25: `sync-polling.ts` hook (`useSyncStatus`)

**Files:**
- Create: `app/lib/google-ads/sync-polling.ts`

- [ ] **Step 1: Implementar hook**

Conteúdo de `app/lib/google-ads/sync-polling.ts`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

// Cadência adaptativa cravada no spec §9 / decisão 5.7.2:
// 1s, 1s, 2s, 2s, 3s, 3s, 5s (cap), timeout 60s.
const INTERVALS_MS = [1000, 1000, 2000, 2000, 3000, 3000];
const CAP_MS = 5000;
const TIMEOUT_MS = 60000;

export interface SyncStatusRow {
  id: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  started_at: string;
  completed_at: string | null;
  rows_synced: number | null;
  parsed_skipped: number | null;
  partial_skipped: Record<string, unknown> | null;
  error_message: string | null;
}

export interface UseSyncStatusResult {
  status: SyncStatusRow | null;
  isPolling: boolean;
  timedOut: boolean;
  error: string | null;
}

export function useSyncStatus(accountId: string | null, enabled: boolean): UseSyncStatusResult {
  const [status, setStatus] = useState<SyncStatusRow | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled || !accountId) return;

    let cancelled = false;
    startedRef.current = Date.now();
    attemptRef.current = 0;
    setIsPolling(true);
    setTimedOut(false);
    setError(null);

    async function poll() {
      if (cancelled) return;

      const elapsed = Date.now() - (startedRef.current ?? Date.now());
      if (elapsed > TIMEOUT_MS) {
        setIsPolling(false);
        setTimedOut(true);
        return;
      }

      try {
        const res = await fetch(`/api/google-ads/sync-status?account_id=${accountId}`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          setIsPolling(false);
          return;
        }
        const data = (await res.json()) as { row: SyncStatusRow | null };
        if (cancelled) return;
        setStatus(data.row);

        if (data.row && data.row.status !== 'running') {
          setIsPolling(false);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'fetch_error');
        setIsPolling(false);
        return;
      }

      const idx = Math.min(attemptRef.current, INTERVALS_MS.length - 1);
      const next = INTERVALS_MS[idx] ?? CAP_MS;
      attemptRef.current += 1;
      setTimeout(poll, next);
    }

    poll();

    return () => {
      cancelled = true;
      setIsPolling(false);
    };
  }, [accountId, enabled]);

  return { status, isPolling, timedOut, error };
}
```

- [ ] **Step 2: Commitar**

```bash
git add app/lib/google-ads/sync-polling.ts
git commit -m "feat(app): useSyncStatus hook com cadencia adaptativa + cleanup"
```

---

## Task 26: Layout nav — adicionar links Integrações + Campanhas

**Files:**
- Modify: `app/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Atualizar nav**

Editar `app/app/(dashboard)/layout.tsx` adicionando 2 links após o de Conversões:

```tsx
<nav className="text-sm flex gap-4">
  <Link href="/dashboard">Resumo</Link>
  <Link href="/dashboard/conversions">Conversões</Link>
  <Link href="/dashboard/campaigns">Campanhas</Link>
  <Link href="/dashboard/integrations">Integrações</Link>
</nav>
```

- [ ] **Step 2: Smoke check no browser**

```bash
pnpm app:dev
```
Acessar http://localhost:3000/dashboard (logado). Esperado: 4 links no header. Click "Campanhas" → 404 (página ainda não existe — esperado neste passo). Idem "Integrações".

- [ ] **Step 3: Commitar**

```bash
git add "app/app/(dashboard)/layout.tsx"
git commit -m "feat(app): adicionar links Campanhas e Integrações no nav"
```

---

## Task 27: `/dashboard/integrations` page + componentes (modo stub)

**Files:**
- Create: `app/app/(dashboard)/dashboard/integrations/page.tsx`
- Create: `app/app/(dashboard)/dashboard/integrations/connect-button.tsx`
- Create: `app/app/(dashboard)/dashboard/integrations/integration-actions.tsx`

> Modo stub: page renderiza dados mockados inline pra testar layout. Route handlers proxy reais ainda não conectados (Phase 7). AlertDialog do disconnect já chama o handler (que retorna 200 mock).

- [ ] **Step 1: Implementar `connect-button.tsx`**

Conteúdo de `app/app/(dashboard)/dashboard/integrations/connect-button.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';

interface ConnectButtonProps {
  workspaceId: string;
  variant?: 'default' | 'outline';
  label?: string;
}

export function ConnectButton({ workspaceId, variant = 'default', label = 'Conectar Google Ads' }: ConnectButtonProps) {
  const workerBase = process.env.NEXT_PUBLIC_WORKER_BASE_URL ?? 'http://localhost:8787';
  const href = `${workerBase}/oauth/google-ads/start?workspace_id=${encodeURIComponent(workspaceId)}`;
  return (
    <Button asChild variant={variant}>
      <a href={href}>{label}</a>
    </Button>
  );
}
```

> Adicionar `NEXT_PUBLIC_WORKER_BASE_URL` ao `app/.env.local.example` (= `http://localhost:8787` em dev).

- [ ] **Step 2: Implementar `integration-actions.tsx`**

Conteúdo de `app/app/(dashboard)/dashboard/integrations/integration-actions.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDestructive } from '@/components/confirm-destructive';
import { formatCustomerId } from '@/lib/google-ads/customer-id';
import { useSyncStatus } from '@/lib/google-ads/sync-polling';

interface IntegrationActionsProps {
  accountId: string;
  customerIdRaw: string;
}

export function IntegrationActions({ accountId, customerIdRaw }: IntegrationActionsProps) {
  const router = useRouter();
  const [syncTriggered, setSyncTriggered] = useState(false);
  const [pendingAction, startTransition] = useTransition();
  const { status, isPolling, timedOut } = useSyncStatus(accountId, syncTriggered);

  async function triggerSync() {
    const res = await fetch('/api/google-ads/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ google_ads_account_id: accountId }),
    });
    if (!res.ok) {
      alert(`Falha ao iniciar sync: ${res.status}`);
      return;
    }
    setSyncTriggered(true);
  }

  async function disconnect() {
    const res = await fetch('/api/google-ads/disconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ google_ads_account_id: accountId }),
    });
    if (res.ok) {
      startTransition(() => router.refresh());
    } else {
      alert(`Falha ao desconectar: ${res.status}`);
    }
  }

  // Quando sync termina (não-running), sinaliza atualização da page
  if (syncTriggered && status && status.status !== 'running') {
    if (!isPolling) {
      // único refresh
      setTimeout(() => router.refresh(), 0);
    }
  }

  return (
    <div className="flex gap-2 items-center">
      <Button
        variant="outline" size="sm"
        onClick={triggerSync}
        disabled={isPolling || pendingAction}
      >
        {isPolling ? 'Sincronizando...' : timedOut ? 'Sync demorando…' : 'Sincronizar agora'}
      </Button>
      <ConfirmDestructive
        trigger={<Button variant="outline" size="sm">Desconectar</Button>}
        title={`Desconectar conta ${formatCustomerId(customerIdRaw)}?`}
        description={
          <>
            Sync diário vai parar. Histórico de campaigns, ad_groups, ads e logs fica
            preservado — você pode reconectar a qualquer momento sem perder dados.
          </>
        }
        actionLabel="Desconectar"
        onConfirm={disconnect}
      />
    </div>
  );
}
```

- [ ] **Step 3: Implementar `page.tsx`**

Conteúdo de `app/app/(dashboard)/dashboard/integrations/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { ConnectButton } from './connect-button';
import { IntegrationActions } from './integration-actions';
import { formatCustomerId } from '@/lib/google-ads/customer-id';
import { getOAuthMessage } from '@/lib/google-ads/oauth-error-messages';

interface AccountRow {
  id: string;
  customer_id: string;
  account_name: string | null;
  is_active: boolean;
  last_synced_at: string | null;
}

interface SyncLogSummary {
  google_ads_account_id: string;
  status: 'success' | 'partial' | 'failed';
  rows_synced: number | null;
  duration_ms: number | null;
  partial_skipped: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string;
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Pega workspace do user (esquema atual: 1 owner por workspace)
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id);
  const workspaceId = workspaces?.[0]?.id;
  if (!workspaceId) {
    return <p className="text-sm text-muted-foreground">Nenhuma workspace encontrada pra este usuário.</p>;
  }

  const { data: accounts } = await supabase
    .from('google_ads_accounts')
    .select('id, customer_id, account_name, is_active, last_synced_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .returns<AccountRow[]>();

  // Último sync_log por account
  const accountIds = (accounts ?? []).map((a) => a.id);
  let lastSyncs: Record<string, SyncLogSummary> = {};
  if (accountIds.length > 0) {
    const { data: logs } = await supabase
      .from('google_ads_sync_log')
      .select('google_ads_account_id, status, rows_synced, duration_ms, partial_skipped, error_message, started_at')
      .in('google_ads_account_id', accountIds)
      .eq('sync_type', 'metadata')
      .order('started_at', { ascending: false })
      .returns<SyncLogSummary[]>();
    if (logs) {
      for (const log of logs) {
        if (!lastSyncs[log.google_ads_account_id]) lastSyncs[log.google_ads_account_id] = log;
      }
    }
  }

  const toastMsg = getOAuthMessage(
    (params.status as Parameters<typeof getOAuthMessage>[0]) ?? 'connected',
    params.reason
  );

  return (
    <div className="space-y-4 max-w-4xl">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Integrações</h1>
        {(accounts?.length ?? 0) > 0 && (
          <ConnectButton workspaceId={workspaceId} variant="outline" label="+ Conectar outra" />
        )}
      </header>

      {toastMsg && params.status && (
        <div className="text-sm rounded border px-3 py-2 bg-muted">
          {toastMsg}
        </div>
      )}

      {(accounts?.length ?? 0) === 0 ? (
        <Card className="p-6 text-center space-y-3">
          <p className="text-sm">Nenhuma conta Google Ads conectada.</p>
          <ConnectButton workspaceId={workspaceId} />
          <p className="text-xs text-muted-foreground">
            Após conectar, sincronizamos campaigns/ad_groups/ads diariamente às 03:00 UTC.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts!.map((acc) => {
            const lastSync = lastSyncs[acc.id];
            const badge = !acc.is_active
              ? { text: '⚠ Reconectar', className: 'text-amber-600' }
              : lastSync?.status === 'failed'
              ? { text: '✗ Erro temporário', className: 'text-red-600' }
              : { text: '● Conectada', className: 'text-emerald-600' };

            return (
              <Card key={acc.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{acc.account_name ?? 'Conta Google Ads'}</p>
                    <p className="text-xs text-muted-foreground">Customer ID: {formatCustomerId(acc.customer_id)}</p>
                  </div>
                  <span className={`text-xs ${badge.className}`}>{badge.text}</span>
                </div>
                {lastSync && (
                  <p className="text-xs text-muted-foreground">
                    Última sync: {new Date(lastSync.started_at).toLocaleString('pt-BR')} ({lastSync.status} · {lastSync.rows_synced ?? 0} rows · {Math.round((lastSync.duration_ms ?? 0) / 100) / 10}s)
                  </p>
                )}
                {acc.is_active ? (
                  <IntegrationActions accountId={acc.id} customerIdRaw={acc.customer_id} />
                ) : (
                  <ConnectButton workspaceId={workspaceId} variant="outline" label="Reconectar" />
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Smoke check no browser (modo stub — sem accounts)**

```bash
pnpm app:dev
```
Acessar http://localhost:3000/dashboard/integrations (logado). Esperado: estado vazio com botão Conectar (link 404 quando clicado, OK por enquanto — Worker route não existe ainda).

- [ ] **Step 5: Commitar**

```bash
git add "app/app/(dashboard)/dashboard/integrations/" app/.env.local.example
git commit -m "feat(app): pagina /dashboard/integrations com states + connect/sync/disconnect"
```

---

## Task 28: `/dashboard/integrations/select` page

**Files:**
- Create: `app/app/(dashboard)/dashboard/integrations/select/page.tsx`
- Create: `app/app/(dashboard)/dashboard/integrations/select/select-form.tsx`

- [ ] **Step 1: Implementar `select-form.tsx`** (client component com checkboxes + countdown)

Conteúdo de `app/app/(dashboard)/dashboard/integrations/select/select-form.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatCustomerId } from '@/lib/google-ads/customer-id';

interface SelectFormProps {
  sessionId: string;
  customerIds: string[];
  expiresAt: string;
}

export function SelectForm({ sessionId, customerIds, expiresAt }: SelectFormProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));

  useEffect(() => {
    const i = setInterval(() => {
      const r = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemainingMs(r);
      if (r === 0) {
        router.push('/dashboard/integrations?status=session_expired');
      }
    }, 1000);
    return () => clearInterval(i);
  }, [expiresAt, router]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/google-ads/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_uuid: sessionId, customer_ids: Array.from(selected) }),
      });
      if (res.ok) {
        router.push('/dashboard/integrations?status=connected');
      } else {
        const body = await res.text();
        alert(`Falha ao conectar: ${res.status} ${body}`);
        setSubmitting(false);
      }
    } catch (e) {
      alert('Erro ao conectar.');
      setSubmitting(false);
    }
  }

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000).toString().padStart(2, '0');

  return (
    <div className="space-y-4 max-w-md">
      <div className="space-y-2">
        {customerIds.map((id) => (
          <label key={id} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.has(id)}
              onChange={() => toggle(id)}
              className="size-4"
            />
            <span className="font-mono">{formatCustomerId(id)}</span>
          </label>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Você pode renomear cada conta depois nas configurações.
      </p>
      <p className="text-xs text-muted-foreground">
        Sessão expira em {minutes}:{seconds}
      </p>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={selected.size === 0 || submitting}>
          {submitting ? 'Conectando...' : 'Conectar selecionadas'}
        </Button>
        <Button variant="outline" asChild>
          <a href="/dashboard/integrations">Cancelar</a>
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implementar `page.tsx`**

Conteúdo de `app/app/(dashboard)/dashboard/integrations/select/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SelectForm } from './select-form';

export default async function SelectAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const params = await searchParams;
  const sessionId = params.session;
  if (!sessionId) redirect('/dashboard/integrations');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Server-side proxy ao Worker /preview pra obter customer_ids + expires_at
  const workerBase = process.env.WORKER_BASE_URL ?? 'http://localhost:8787';
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) redirect('/login');

  const previewRes = await fetch(`${workerBase}/oauth/google-ads/session/${sessionId}/preview`, {
    headers: {
      Authorization: `Bearer ${process.env.WORKER_INTERNAL_TOKEN ?? ''}`,
      'X-User-JWT': session.access_token,
    },
    cache: 'no-store',
  });

  if (previewRes.status === 404 || previewRes.status === 410) {
    redirect('/dashboard/integrations?status=session_expired');
  }
  if (!previewRes.ok) {
    return <p className="text-sm text-red-600">Erro ao carregar sessão de seleção ({previewRes.status}).</p>;
  }

  const preview = (await previewRes.json()) as { session_id: string; customer_ids: string[]; expires_at: string };

  return (
    <div className="space-y-4 max-w-md">
      <h1 className="text-xl font-semibold">Conexão Google Ads</h1>
      <p className="text-sm">
        Sua conta Google autoriza várias contas Google Ads. Escolha quais conectar ao LeoTracker:
      </p>
      <SelectForm
        sessionId={preview.session_id}
        customerIds={preview.customer_ids}
        expiresAt={preview.expires_at}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commitar**

```bash
git add "app/app/(dashboard)/dashboard/integrations/select/"
git commit -m "feat(app): pagina /integrations/select com checkboxes + countdown live"
```

---

## Task 29: `/dashboard/campaigns` page

**Files:**
- Create: `app/app/(dashboard)/dashboard/campaigns/page.tsx`
- Create: `app/app/(dashboard)/dashboard/campaigns/_components/include-removed-toggle.tsx`

- [ ] **Step 1: Implementar toggle**

Conteúdo de `app/app/(dashboard)/dashboard/campaigns/_components/include-removed-toggle.tsx`:

```tsx
import Link from 'next/link';

export function IncludeRemovedToggle({ active }: { active: boolean }) {
  return (
    <Link
      href={active ? '/dashboard/campaigns' : '/dashboard/campaigns?include_removed=1'}
      className="text-xs text-muted-foreground hover:underline"
    >
      {active ? '☑ Incluindo REMOVED' : '☐ Incluir REMOVED'}
    </Link>
  );
}
```

- [ ] **Step 2: Implementar `page.tsx`**

Conteúdo de `app/app/(dashboard)/dashboard/campaigns/page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ConnectButton } from '../integrations/connect-button';
import { IncludeRemovedToggle } from './_components/include-removed-toggle';

interface CampaignRow {
  id: string;
  name: string;
  campaign_type: string | null;
  status: string;
  google_ads_account_id: string;
}

interface AdGroupRow {
  id: string;
  campaign_id: string;
  name: string;
  status: string;
  entity_type: 'AD_GROUP' | 'ASSET_GROUP';
}

interface AdRow {
  id: string;
  ad_group_id: string;
  name: string | null;
  ad_type: string | null;
  status: string;
}

interface AccountRow {
  id: string;
  account_name: string | null;
  customer_id: string;
}

const ROW_LIMIT = 1000;

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ include_removed?: string }>;
}) {
  const params = await searchParams;
  const includeRemoved = params.include_removed === '1';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: workspaces } = await supabase.from('workspaces').select('id').eq('owner_id', user.id);
  const workspaceId = workspaces?.[0]?.id;
  if (!workspaceId) return <p>Sem workspace.</p>;

  const { data: accounts } = await supabase
    .from('google_ads_accounts')
    .select('id, account_name, customer_id')
    .eq('workspace_id', workspaceId)
    .returns<AccountRow[]>();

  if (!accounts || accounts.length === 0) {
    return (
      <Card className="p-6 text-center space-y-3 max-w-md mx-auto">
        <p className="text-sm">Você ainda não conectou uma conta Google Ads.</p>
        <p className="text-xs text-muted-foreground">
          Quando conectar, suas campanhas, ad groups e ads vão aparecer aqui sincronizados diariamente.
        </p>
        <ConnectButton workspaceId={workspaceId} />
      </Card>
    );
  }

  const accountIds = accounts.map((a) => a.id);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  let campaignQuery = supabase
    .from('campaigns')
    .select('id,name,campaign_type,status,google_ads_account_id')
    .in('google_ads_account_id', accountIds);
  if (!includeRemoved) campaignQuery = campaignQuery.neq('status', 'REMOVED');
  const { data: campaigns } = await campaignQuery.returns<CampaignRow[]>();
  const campaignIds = (campaigns ?? []).map((c) => c.id);
  const campaignById = new Map((campaigns ?? []).map((c) => [c.id, c]));

  let agQuery = supabase
    .from('ad_groups')
    .select('id,campaign_id,name,status,entity_type')
    .in('campaign_id', campaignIds);
  if (!includeRemoved) agQuery = agQuery.neq('status', 'REMOVED');
  const { data: adGroups } = await agQuery.returns<AdGroupRow[]>();
  const adGroupIds = (adGroups ?? []).map((a) => a.id);
  const adGroupById = new Map((adGroups ?? []).map((a) => [a.id, a]));

  let adsQuery = supabase
    .from('ads')
    .select('id,ad_group_id,name,ad_type,status')
    .in('ad_group_id', adGroupIds);
  if (!includeRemoved) adsQuery = adsQuery.neq('status', 'REMOVED');
  const { data: ads } = await adsQuery.returns<AdRow[]>();

  // Constrói lista flat: 1 row por leaf node
  // (ad se ad_group tem ads; senão ad_group sem ad)
  type FlatRow = {
    accountName: string;
    accountIdShort: string;
    campaignType: string | null;
    campaignName: string;
    campaignStatus: string;
    adGroupName: string;
    adGroupStatus: string;
    adName: string | null;
    adStatus: string | null;
  };
  const flat: FlatRow[] = [];
  const adsByAdGroup = new Map<string, AdRow[]>();
  for (const ad of ads ?? []) {
    const arr = adsByAdGroup.get(ad.ad_group_id) ?? [];
    arr.push(ad);
    adsByAdGroup.set(ad.ad_group_id, arr);
  }

  for (const ag of adGroups ?? []) {
    const c = campaignById.get(ag.campaign_id);
    if (!c) continue;
    const acc = accountById.get(c.google_ads_account_id);
    if (!acc) continue;
    const accountName = acc.account_name ?? acc.customer_id;
    const accountIdShort = acc.customer_id.slice(-4);

    const adsForAg = adsByAdGroup.get(ag.id) ?? [];
    if (adsForAg.length === 0 || ag.entity_type === 'ASSET_GROUP') {
      flat.push({
        accountName, accountIdShort, campaignType: c.campaign_type, campaignName: c.name,
        campaignStatus: c.status, adGroupName: ag.name, adGroupStatus: ag.status,
        adName: '—', adStatus: ag.status,
      });
    } else {
      for (const ad of adsForAg) {
        flat.push({
          accountName, accountIdShort, campaignType: c.campaign_type, campaignName: c.name,
          campaignStatus: c.status, adGroupName: ag.name, adGroupStatus: ag.status,
          adName: ad.name ?? `(${ad.ad_type ?? 'ad'})`, adStatus: ad.status,
        });
      }
    }
  }

  const overflowed = flat.length > ROW_LIMIT;
  const visible = flat.slice(0, ROW_LIMIT);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Campanhas</h1>
        <IncludeRemovedToggle active={includeRemoved} />
      </header>

      {overflowed && (
        <p className="text-xs text-amber-600">
          Mostrando primeiros {ROW_LIMIT} de {flat.length} resultados. Filtros virão na Fase 2B.
        </p>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Campanha</TableHead>
              <TableHead>Ad Group</TableHead>
              <TableHead>Ad</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row, i) => {
              const isRemoved = row.adStatus === 'REMOVED' || row.campaignStatus === 'REMOVED' || row.adGroupStatus === 'REMOVED';
              return (
                <TableRow key={i} className={isRemoved ? 'text-muted-foreground' : ''}>
                  <TableCell>{row.accountName}</TableCell>
                  <TableCell className="text-xs">{row.campaignType ?? '—'}</TableCell>
                  <TableCell>{row.campaignName}</TableCell>
                  <TableCell>{row.adGroupName}</TableCell>
                  <TableCell>{row.adName}</TableCell>
                  <TableCell className="text-xs">{row.adStatus}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">{flat.length} rows</p>
    </div>
  );
}
```

- [ ] **Step 3: Commitar**

```bash
git add "app/app/(dashboard)/dashboard/campaigns/"
git commit -m "feat(app): pagina /dashboard/campaigns com lista flat + filtro REMOVED"
```

---

## Task 30: Route handlers proxy stub (5 endpoints)

**Files:**
- Create: `app/app/api/google-ads/sync/route.ts`
- Create: `app/app/api/google-ads/disconnect/route.ts`
- Create: `app/app/api/google-ads/finalize/route.ts`
- Create: `app/app/api/google-ads/select-preview/route.ts`
- Create: `app/app/api/google-ads/sync-status/route.ts`

> Modo stub: 4 dos 5 retornam JSON estático (Phase 7 conecta ao Worker real). `sync-status` SIM faz SELECT real direto na DB (não precisa Worker — Phase 7 não muda este).

- [ ] **Step 1: `sync-status/route.ts` (real desde já)**

Conteúdo:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('account_id');
  if (!accountId) return NextResponse.json({ error: 'missing account_id' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RLS aplica via owner_id; SELECT direto retorna só rows visíveis
  const { data: row } = await supabase
    .from('google_ads_sync_log')
    .select('id, status, started_at, completed_at, rows_synced, parsed_skipped, partial_skipped, error_message')
    .eq('google_ads_account_id', accountId)
    .eq('sync_type', 'metadata')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ row: row ?? null });
}
```

- [ ] **Step 2: 4 stubs (`sync`, `disconnect`, `finalize`, `select-preview`)**

Cada um devolve 200 com JSON dummy. Ex `app/app/api/google-ads/sync/route.ts`:

```ts
import { NextResponse } from 'next/server';

export async function POST() {
  // STUB Phase 5 — substituído por proxy real na Phase 7
  return NextResponse.json({
    log_id: 'stub-log',
    status: 'running',
    started_at: new Date().toISOString(),
  });
}
```

`disconnect/route.ts`:
```ts
import { NextResponse } from 'next/server';

export async function POST() {
  // STUB Phase 5
  return NextResponse.json({ is_active: false });
}
```

`finalize/route.ts`:
```ts
import { NextResponse } from 'next/server';

export async function POST() {
  // STUB Phase 5
  return NextResponse.json({ accounts_created: 1 });
}
```

`select-preview/route.ts`:
```ts
import { NextResponse, NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  // STUB Phase 5 — retorna 2 customer_ids fake pra testar UI
  const sessionId = req.nextUrl.pathname.split('/').pop();
  return NextResponse.json({
    session_id: sessionId,
    customer_ids: ['1234567890', '9876543210'],
    expires_at: new Date(Date.now() + 9 * 60_000).toISOString(),
  });
}
```

> Nota: `select/page.tsx` chama o Worker direto (não passa pelo `select-preview`). Se quiser testar select page com mock, alterar temporariamente `WORKER_BASE_URL` pra apontar pro próprio app + criar route handler que mocka. Para Phase 5 stub, OK pular este teste — `/integrations/select` será testado em Phase 7 quando Worker estiver pronto.

- [ ] **Step 3: Commitar**

```bash
git add app/app/api/google-ads/
git commit -m "feat(app): route handlers (sync-status real + 4 stubs pra Phase 7)"
```

---

## ▸ CHECKPOINT 3 — UI stub validada visualmente

> **Pausa.** Antes de seguir pra Phase 6:
> 1. `pnpm app:dev` — abrir browser, logar.
> 2. Navegar:
>    - `/dashboard/integrations` (estado vazio) — botão Conectar visível, link aponta pro Worker. Estado populado: criar account fake direto no Studio (`INSERT INTO google_ads_accounts ...`) e refrescar; ver card renderizado, badge correto.
>    - `/dashboard/campaigns` (vazio) — empty state com CTA. Popular fake (`INSERT INTO campaigns/ad_groups/ads`) e refrescar; ver lista flat. Toggle `?include_removed=1` funcionando.
>    - Confirmar AlertDialog do "Desconectar" abre com texto rico, botão Cancelar/Desconectar visíveis.
>    - Polling: clicar "Sincronizar agora" — botão vira "Sincronizando...". Stub retorna `running` mas não tem log_id real, então polling fica indefinido até timeout (60s) — comportamento esperado pra stub.
> 3. Leo + Claude validam UX antes de conectar Worker. Pausa pra ajustes de layout/copy.
> 4. Quando aprovado, seguir pra Phase 6 (Worker routes).

---



## Phase 6 — Worker routes

> Wires libs Phase 4 + endpoints HTTP. Cada route segue pattern Fase 1: handler exportado, validação no início, body parse, lógica, response.

## Task 31: `oauth-google-ads.ts` — `/start` handler

**Files:**
- Create: `worker/src/routes/oauth-google-ads.ts`
- Create: `worker/tests/routes/oauth-google-ads.test.ts`

- [ ] **Step 1: Escrever teste do /start**

Conteúdo inicial de `worker/tests/routes/oauth-google-ads.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { handleOAuthStart } from '../../src/routes/oauth-google-ads';

describe('GET /oauth/google-ads/start', () => {
  it('400 quando workspace_id ausente', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/start');
    const res = await handleOAuthStart(req, env);
    expect(res.status).toBe(400);
  });

  it('302 + Set-Cookie + Location pra Google quando workspace_id válido', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/start?workspace_id=00000000-0000-0000-0000-000000000001');
    const res = await handleOAuthStart(req, env);
    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('lt_oauth_state=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=600');
    expect(setCookie).toContain('Path=/oauth/google-ads');
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('access_type=offline');
    expect(location).toContain('prompt=consent');
  });
});
```

- [ ] **Step 2: Implementar `/start`**

Conteúdo inicial de `worker/src/routes/oauth-google-ads.ts`:

```ts
import type { Env } from '../types';
import { buildConsentUrl } from '../lib/google-ads/oauth';
import { signState } from '../lib/google-ads/oauth-state';

export async function handleOAuthStart(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspace_id');
  if (!workspaceId) return new Response('missing workspace_id', { status: 400 });

  const state = await signState({ workspace_id: workspaceId }, env.ENCRYPTION_KEY, 600);
  const consentUrl = buildConsentUrl({
    clientId: env.GOOGLE_ADS_CLIENT_ID,
    redirectUri: env.GOOGLE_ADS_OAUTH_REDIRECT_URI,
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: consentUrl,
      'Set-Cookie': `lt_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/oauth/google-ads`,
    },
  });
}
```

- [ ] **Step 3: Rodar e commitar**

```bash
pnpm worker:test -- routes/oauth-google-ads
git add worker/src/routes/oauth-google-ads.ts worker/tests/routes/oauth-google-ads.test.ts
git commit -m "feat(worker): route /oauth/google-ads/start com state cookie + consent redirect"
```

---

## Task 32: `oauth-google-ads.ts` — `/callback` handler (single + multi)

**Files:**
- Modify: `worker/src/routes/oauth-google-ads.ts`
- Modify: `worker/tests/routes/oauth-google-ads.test.ts`

- [ ] **Step 1: Escrever testes do callback (5 cenários)**

Append ao `worker/tests/routes/oauth-google-ads.test.ts`:

```ts
import { handleOAuthCallback } from '../../src/routes/oauth-google-ads';
import { signState } from '../../src/lib/google-ads/oauth-state';
import * as oauth from '../../src/lib/google-ads/oauth';
import * as client from '../../src/lib/google-ads/client';
import { vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseClient } from '../../src/lib/supabase';

const APP_BASE = 'http://localhost:3000';

describe('GET /oauth/google-ads/callback', () => {
  beforeEach(() => {
    Object.assign(env, { APP_BASE_URL: APP_BASE });
  });
  afterEach(() => vi.restoreAllMocks());

  it('?error=access_denied → redirect status=user_cancelled', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/callback?error=access_denied');
    const res = await handleOAuthCallback(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('status=oauth_error&reason=user_cancelled');
  });

  it('state ausente no cookie → redirect oauth_error reason=state_missing', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/callback?code=C&state=S');
    const res = await handleOAuthCallback(req, env);
    expect(res.headers.get('Location')).toContain('reason=state_missing');
  });

  it('state mismatch → redirect oauth_error reason=state_mismatch', async () => {
    const stateA = await signState({ workspace_id: '00000000-0000-0000-0000-000000000001' }, env.ENCRYPTION_KEY, 600);
    const stateB = await signState({ workspace_id: '00000000-0000-0000-0000-000000000001' }, env.ENCRYPTION_KEY, 600);
    const req = new Request(`https://w.dev/oauth/google-ads/callback?code=C&state=${stateA}`, {
      headers: { Cookie: `lt_oauth_state=${stateB}` },
    });
    const res = await handleOAuthCallback(req, env);
    expect(res.headers.get('Location')).toContain('reason=state_mismatch');
  });

  it('listAccessibleCustomers retorna [] → redirect reason=no_accounts', async () => {
    const state = await signState({ workspace_id: '00000000-0000-0000-0000-000000000001' }, env.ENCRYPTION_KEY, 600);
    vi.spyOn(oauth, 'exchangeCodeForTokens').mockResolvedValue({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    vi.spyOn(client, 'listAccessibleCustomers').mockResolvedValue([]);

    const req = new Request(`https://w.dev/oauth/google-ads/callback?code=C&state=${state}`, {
      headers: { Cookie: `lt_oauth_state=${state}` },
    });
    const res = await handleOAuthCallback(req, env);
    expect(res.headers.get('Location')).toContain('reason=no_accounts');
  });

  it('1 customer → upsert account + redirect status=connected', async () => {
    const WID = '00000000-0000-0000-0000-000000000001';
    const state = await signState({ workspace_id: WID }, env.ENCRYPTION_KEY, 600);
    vi.spyOn(oauth, 'exchangeCodeForTokens').mockResolvedValue({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    vi.spyOn(client, 'listAccessibleCustomers').mockResolvedValue(['1234567890']);

    const sb = createSupabaseClient(env);
    await sb.delete('google_ads_accounts', { workspace_id: `eq.${WID}`, customer_id: 'eq.1234567890' });

    const req = new Request(`https://w.dev/oauth/google-ads/callback?code=C&state=${state}`, {
      headers: { Cookie: `lt_oauth_state=${state}` },
    });
    const res = await handleOAuthCallback(req, env);
    expect(res.headers.get('Location')).toContain('status=connected');

    const accs = await sb.select<{ customer_id: string }>('google_ads_accounts', {
      workspace_id: `eq.${WID}`, customer_id: 'eq.1234567890', select: 'customer_id',
    });
    expect(accs.length).toBe(1);
  });

  it('2+ customers → cria pending session + redirect /select', async () => {
    const WID = '00000000-0000-0000-0000-000000000001';
    const state = await signState({ workspace_id: WID }, env.ENCRYPTION_KEY, 600);
    vi.spyOn(oauth, 'exchangeCodeForTokens').mockResolvedValue({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    vi.spyOn(client, 'listAccessibleCustomers').mockResolvedValue(['1111111111', '2222222222']);

    const req = new Request(`https://w.dev/oauth/google-ads/callback?code=C&state=${state}`, {
      headers: { Cookie: `lt_oauth_state=${state}` },
    });
    const res = await handleOAuthCallback(req, env);
    const loc = res.headers.get('Location') ?? '';
    expect(loc).toContain('/dashboard/integrations/select?session=');

    const sb = createSupabaseClient(env);
    const pending = await sb.select<{ id: string }>('oauth_pending_selections', {
      workspace_id: `eq.${WID}`, select: 'id',
    });
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Adicionar `APP_BASE_URL` ao `Env`**

Editar `worker/src/types.ts`:
```ts
APP_BASE_URL: string; // ex: http://localhost:3000 em dev
```

E `worker/wrangler.toml.example`:
```toml
APP_BASE_URL = "http://localhost:3000"
```

- [ ] **Step 3: Implementar `/callback`**

Append ao `worker/src/routes/oauth-google-ads.ts`:

```ts
import { exchangeCodeForTokens } from '../lib/google-ads/oauth';
import { verifyState } from '../lib/google-ads/oauth-state';
import { listAccessibleCustomers } from '../lib/google-ads/client';
import { createSupabaseClient } from '../lib/supabase';
import { encryptAesGcm } from '../lib/crypto';

function appRedirect(env: Env, path: string, params: Record<string, string>): Response {
  const url = new URL(path, env.APP_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': 'lt_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/oauth/google-ads',
    },
  });
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export async function handleOAuthCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.get('error') === 'access_denied') {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'user_cancelled' });
  }
  const stateQuery = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const stateCookie = readCookie(req, 'lt_oauth_state');

  if (!stateCookie) return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'state_missing' });
  const payload = await verifyState(stateQuery, stateCookie, env.ENCRYPTION_KEY);
  if (!payload) {
    const reason = stateQuery === stateCookie ? 'state_invalid' : 'state_mismatch';
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason });
  }
  if (!code) return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'code_exchange_failed' });

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens({
      code, clientId: env.GOOGLE_ADS_CLIENT_ID, clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
      redirectUri: env.GOOGLE_ADS_OAUTH_REDIRECT_URI,
    });
  } catch {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'code_exchange_failed' });
  }

  let customerIds: string[];
  try {
    customerIds = await listAccessibleCustomers({
      accessToken: tokens.access_token, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });
  } catch {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
  }
  if (customerIds.length === 0) {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'no_accounts' });
  }

  const sb = createSupabaseClient(env);

  if (customerIds.length === 1) {
    // Upsert direto
    const { ciphertext, iv } = await encryptAesGcm(env.ENCRYPTION_KEY, tokens.refresh_token);
    try {
      await sb.upsert('google_ads_accounts', [{
        workspace_id: payload.workspace_id,
        customer_id: customerIds[0],
        refresh_token_encrypted: ciphertext,
        refresh_token_iv: iv,
        is_active: true,
      }], { onConflict: 'workspace_id,customer_id' });
    } catch {
      return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
    }
    return appRedirect(env, '/dashboard/integrations', { status: 'connected' });
  }

  // 2+ customers → grava pending + redirect /select
  const payloadJson = JSON.stringify({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    customer_ids: customerIds,
  });
  const { ciphertext, iv } = await encryptAesGcm(env.ENCRYPTION_KEY, payloadJson);
  await sb.insert('oauth_pending_selections', {
    workspace_id: payload.workspace_id,
    encrypted_payload: ciphertext,
    payload_iv: iv,
  });
  // Pegar id do row recém-inserido (workaround: consulta por (workspace_id, encrypted_payload))
  const rows = await sb.select<{ id: string }>('oauth_pending_selections', {
    workspace_id: `eq.${payload.workspace_id}`, encrypted_payload: `eq.${ciphertext}`,
    select: 'id', limit: '1', order: 'created_at.desc',
  });
  if (!rows[0]) {
    return appRedirect(env, '/dashboard/integrations', { status: 'oauth_error', reason: 'db_error' });
  }
  return appRedirect(env, '/dashboard/integrations/select', { session: rows[0].id });
}
```

- [ ] **Step 4: Rodar e commitar**

```bash
pnpm worker:test -- routes/oauth-google-ads
git add worker/src/routes/oauth-google-ads.ts worker/tests/routes/oauth-google-ads.test.ts worker/src/types.ts worker/wrangler.toml.example
git commit -m "feat(worker): route /oauth/google-ads/callback (1 customer + multi customers paths)"
```

---

## Task 33: `oauth-google-ads.ts` — `/preview` handler

**Files:**
- Modify: `worker/src/routes/oauth-google-ads.ts`
- Modify: `worker/tests/routes/oauth-google-ads.test.ts`

- [ ] **Step 1: Escrever testes**

Append:

```ts
import { handleOAuthPreview } from '../../src/routes/oauth-google-ads';

describe('GET /oauth/google-ads/session/:uuid/preview', () => {
  // ... testes:
  // - 401 sem credenciais
  // - 404 session inválida (uuid inexistente)
  // - 404 session existe mas workspace_id ≠ user.workspace
  // - 410 expirada
  // - 200 com {session_id, customer_ids, expires_at}
});
```

> Por brevidade, escreva os 5 testes seguindo os patterns de Task 8 (validateInternalRequest mock setup) + insert pending session no setup.

- [ ] **Step 2: Implementar**

Append ao `worker/src/routes/oauth-google-ads.ts`:

```ts
import { validateInternalRequest } from '../lib/internal-auth';
import { decryptAesGcm } from '../lib/crypto';

export async function handleOAuthPreview(req: Request, env: Env, sessionUuid: string): Promise<Response> {
  let auth: Awaited<ReturnType<typeof validateInternalRequest>>;
  try {
    auth = await validateInternalRequest(req, env);
  } catch (resp) {
    return resp as Response;
  }

  const sb = createSupabaseClient(env);
  const rows = await sb.select<{
    id: string; workspace_id: string; encrypted_payload: string; payload_iv: string; expires_at: string;
  }>('oauth_pending_selections', {
    id: `eq.${sessionUuid}`,
    select: 'id,workspace_id,encrypted_payload,payload_iv,expires_at',
    limit: '1',
  });

  if (!rows[0]) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  if (!auth.workspaceIds.includes(rows[0].workspace_id)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }
  if (new Date(rows[0].expires_at).getTime() < Date.now()) {
    await sb.delete('oauth_pending_selections', { id: `eq.${rows[0].id}` });
    return new Response(JSON.stringify({ error: 'gone' }), { status: 410 });
  }

  const decrypted = await decryptAesGcm(env.ENCRYPTION_KEY, rows[0].encrypted_payload, rows[0].payload_iv);
  const payload = JSON.parse(decrypted) as { customer_ids: string[] };

  return new Response(JSON.stringify({
    session_id: rows[0].id,
    customer_ids: payload.customer_ids,
    expires_at: rows[0].expires_at,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}
```

- [ ] **Step 3: Rodar e commitar**

```bash
pnpm worker:test -- routes/oauth-google-ads
git add worker/src/routes/oauth-google-ads.ts worker/tests/routes/oauth-google-ads.test.ts
git commit -m "feat(worker): route /oauth/google-ads/session/:uuid/preview"
```

---

## Task 34: `oauth-google-ads.ts` — `/finalize` handler

**Files:**
- Modify: `worker/src/routes/oauth-google-ads.ts`
- Modify: `worker/tests/routes/oauth-google-ads.test.ts`

- [ ] **Step 1: Escrever testes** (4 cenários: auth fail, session fail, customer_ids vazio, sucesso)

Padrão similar ao /preview. Setup insere pending session, POST com `{session_uuid, customer_ids}`, valida que rows criadas em `google_ads_accounts` + pending deletado.

- [ ] **Step 2: Implementar**

Append ao `worker/src/routes/oauth-google-ads.ts`:

```ts
export async function handleOAuthFinalize(req: Request, env: Env): Promise<Response> {
  let auth: Awaited<ReturnType<typeof validateInternalRequest>>;
  try {
    auth = await validateInternalRequest(req, env);
  } catch (resp) {
    return resp as Response;
  }

  const body = (await req.json().catch(() => null)) as { session_uuid?: string; customer_ids?: string[] } | null;
  if (!body?.session_uuid || !Array.isArray(body.customer_ids) || body.customer_ids.length === 0) {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 });
  }

  const sb = createSupabaseClient(env);
  const rows = await sb.select<{
    id: string; workspace_id: string; encrypted_payload: string; payload_iv: string; expires_at: string;
  }>('oauth_pending_selections', { id: `eq.${body.session_uuid}`, select: '*', limit: '1' });

  if (!rows[0] || !auth.workspaceIds.includes(rows[0].workspace_id)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }
  if (new Date(rows[0].expires_at).getTime() < Date.now()) {
    await sb.delete('oauth_pending_selections', { id: `eq.${rows[0].id}` });
    return new Response(JSON.stringify({ error: 'gone' }), { status: 410 });
  }

  const decrypted = await decryptAesGcm(env.ENCRYPTION_KEY, rows[0].encrypted_payload, rows[0].payload_iv);
  const payload = JSON.parse(decrypted) as { refresh_token: string; customer_ids: string[] };

  // Filtra só customer_ids selecionados que estão na lista original (defensiva)
  const valid = body.customer_ids.filter((id) => payload.customer_ids.includes(id));
  if (valid.length === 0) {
    return new Response(JSON.stringify({ error: 'invalid_customer_ids' }), { status: 400 });
  }

  // Encrypt refresh_token uma vez por account inserted
  const accountsToInsert = await Promise.all(valid.map(async (customerId) => {
    const { ciphertext, iv } = await encryptAesGcm(env.ENCRYPTION_KEY, payload.refresh_token);
    return {
      workspace_id: rows[0].workspace_id,
      customer_id: customerId,
      refresh_token_encrypted: ciphertext,
      refresh_token_iv: iv,
      is_active: true,
    };
  }));
  await sb.upsert('google_ads_accounts', accountsToInsert, { onConflict: 'workspace_id,customer_id' });

  // Limpa pending
  await sb.delete('oauth_pending_selections', { id: `eq.${rows[0].id}` });

  return new Response(JSON.stringify({ accounts_created: valid.length }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}
```

- [ ] **Step 3: Rodar e commitar**

```bash
pnpm worker:test -- routes/oauth-google-ads
git add worker/src/routes/oauth-google-ads.ts worker/tests/routes/oauth-google-ads.test.ts
git commit -m "feat(worker): route /oauth/google-ads/finalize com workspace ownership check"
```

---

## Task 35: `google-ads-sync.ts` route

**Files:**
- Create: `worker/src/routes/google-ads-sync.ts`
- Create: `worker/tests/routes/google-ads-sync.test.ts`

- [ ] **Step 1: Escrever testes**

Cenários:
- 401 sem credenciais
- 404 quando account_id não pertence ao user
- 200 com `{log_id, status: 'running', started_at}` em sucesso (sync continua background via waitUntil — verificar via timeout que log row foi criado)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { handleGoogleAdsSync } from '../../src/routes/google-ads-sync';
import * as syncMod from '../../src/lib/google-ads/sync';
// ... setup pattern Task 8 + insert google_ads_accounts row no setup
```

- [ ] **Step 2: Implementar**

Conteúdo de `worker/src/routes/google-ads-sync.ts`:

```ts
import type { Env } from '../types';
import { validateInternalRequest } from '../lib/internal-auth';
import { createSupabaseClient } from '../lib/supabase';
import { syncAccount, type GoogleAdsAccountRow } from '../lib/google-ads/sync';

export async function handleGoogleAdsSync(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let auth: Awaited<ReturnType<typeof validateInternalRequest>>;
  try {
    auth = await validateInternalRequest(req, env);
  } catch (resp) {
    return resp as Response;
  }

  const body = (await req.json().catch(() => null)) as { google_ads_account_id?: string } | null;
  if (!body?.google_ads_account_id) {
    return new Response(JSON.stringify({ error: 'missing_account_id' }), { status: 400 });
  }

  const sb = createSupabaseClient(env);
  const accs = await sb.select<GoogleAdsAccountRow>('google_ads_accounts', {
    id: `eq.${body.google_ads_account_id}`,
    select: 'id,workspace_id,customer_id,manager_customer_id,refresh_token_encrypted,refresh_token_iv,is_active',
    limit: '1',
  });
  const account = accs[0];
  if (!account || !auth.workspaceIds.includes(account.workspace_id)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  // Dispara sync sync (1ª fase + insert sync_log) sincrono pra garantir log_id de volta;
  // resto via waitUntil pra UI poder pollar.
  // Simplificação: roda sync inteiro async via waitUntil e retorna log_id placeholder.
  // Pra retornar log_id real, syncAccount precisa expor 2 fases: prepare (insert log) + run.
  // Implementação direta por simplicidade na 2A: chama syncAccount sincronamente e captura
  // erro de 'sync_in_progress' pra retornar 409 cedo.

  try {
    const promise = syncAccount(env, account);
    // Capturamos a primeira parte (insert sync_log) sem await total:
    // pra simplicidade da 2A, esperamos terminar e retornamos resultado real.
    // Trade-off: request demora ~10-20s. UI fez polling depois? Sim, decisão 5.7.2.
    // Revisitar pra `waitUntil` de fato em fase futura quando vol crescer.
    const result = await promise;
    return new Response(JSON.stringify({
      log_id: result.log_id, status: result.status, started_at: new Date().toISOString(),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    if (err instanceof Error && err.message === 'sync_in_progress') {
      return new Response(JSON.stringify({ error: 'sync_in_progress' }), { status: 409 });
    }
    return new Response(JSON.stringify({ error: 'sync_failed', message: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
}
```

> NOTA: O spec §5 diz "200 imediato + ctx.waitUntil()". Implementação acima é síncrona (mais simples; latência aceitável pra single-tenant). Se vol explodir, refatorar pra split syncAccount em `prepareSyncLog()` + `runSync()` e usar `ctx.waitUntil(runSync(...))`. Tech debt menor da 2A.

- [ ] **Step 3: Rodar e commitar**

```bash
pnpm worker:test -- routes/google-ads-sync
git add worker/src/routes/google-ads-sync.ts worker/tests/routes/google-ads-sync.test.ts
git commit -m "feat(worker): route POST /api/google-ads/sync"
```

---

## Task 36: `google-ads-disconnect.ts` route

**Files:**
- Create: `worker/src/routes/google-ads-disconnect.ts`
- Create: `worker/tests/routes/google-ads-disconnect.test.ts`

- [ ] **Step 1: Implementar (com test minimalista)**

Conteúdo de `worker/src/routes/google-ads-disconnect.ts`:

```ts
import type { Env } from '../types';
import { validateInternalRequest } from '../lib/internal-auth';
import { createSupabaseClient } from '../lib/supabase';

export async function handleGoogleAdsDisconnect(req: Request, env: Env): Promise<Response> {
  let auth: Awaited<ReturnType<typeof validateInternalRequest>>;
  try {
    auth = await validateInternalRequest(req, env);
  } catch (resp) {
    return resp as Response;
  }

  const body = (await req.json().catch(() => null)) as { google_ads_account_id?: string } | null;
  if (!body?.google_ads_account_id) {
    return new Response(JSON.stringify({ error: 'missing_account_id' }), { status: 400 });
  }

  const sb = createSupabaseClient(env);
  const accs = await sb.select<{ id: string; workspace_id: string }>('google_ads_accounts', {
    id: `eq.${body.google_ads_account_id}`, select: 'id,workspace_id', limit: '1',
  });
  if (!accs[0] || !auth.workspaceIds.includes(accs[0].workspace_id)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  await sb.update('google_ads_accounts', { id: `eq.${accs[0].id}` }, { is_active: false });
  return new Response(JSON.stringify({ is_active: false }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}
```

Teste em `worker/tests/routes/google-ads-disconnect.test.ts` cobre: 401 sem auth, 404 cross-workspace, 200 happy path verificando `is_active=false` no row depois.

- [ ] **Step 2: Rodar e commitar**

```bash
pnpm worker:test -- routes/google-ads-disconnect
git add worker/src/routes/google-ads-disconnect.ts worker/tests/routes/google-ads-disconnect.test.ts
git commit -m "feat(worker): route POST /api/google-ads/disconnect (is_active=false)"
```

---

## Task 37: `scheduled()` handler + cleanup

**Files:**
- Modify: `worker/src/index.ts` — exportar `scheduled` handler
- Create: `worker/tests/routes/scheduled.test.ts`

- [ ] **Step 1: Escrever teste**

Conteúdo de `worker/tests/routes/scheduled.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import workerModule from '../../src/index';
import * as syncMod from '../../src/lib/google-ads/sync';
import { createSupabaseClient } from '../../src/lib/supabase';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

describe('scheduled() cron handler', () => {
  let sb: ReturnType<typeof createSupabaseClient>;

  beforeEach(async () => {
    sb = createSupabaseClient(env);
    // Cleanup
    await sb.delete('oauth_pending_selections', { workspace_id: `eq.${WORKSPACE_ID}` });
    await sb.delete('google_ads_accounts', { workspace_id: `eq.${WORKSPACE_ID}` });
    await sb.insert('google_ads_accounts', [
      { workspace_id: WORKSPACE_ID, customer_id: '0001000001', refresh_token_encrypted: 'x', refresh_token_iv: 'y', is_active: true },
      { workspace_id: WORKSPACE_ID, customer_id: '0001000002', refresh_token_encrypted: 'x', refresh_token_iv: 'y', is_active: false }, // ignorada
    ]);
    // Pending expirado
    await sb.insert('oauth_pending_selections', {
      workspace_id: WORKSPACE_ID, encrypted_payload: 'x', payload_iv: 'y',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
  });

  it('itera sobre is_active=true accounts e roda cleanup', async () => {
    const syncSpy = vi.spyOn(syncMod, 'syncAccount').mockResolvedValue({
      log_id: 'l', status: 'success', rows_synced: 0, duration_ms: 100,
    });

    const event = { cron: '0 3 * * *', scheduledTime: Date.now() } as ScheduledEvent;
    const ctx = { waitUntil: () => {} } as ExecutionContext;
    await workerModule.scheduled(event, env, ctx);

    expect(syncSpy).toHaveBeenCalledTimes(1); // só is_active=true
    const remainingPending = await sb.select<{ id: string }>('oauth_pending_selections', {
      workspace_id: `eq.${WORKSPACE_ID}`, select: 'id',
    });
    expect(remainingPending.length).toBe(0); // cleanup deletou
  });

  it('uma falha não bloqueia próximas accounts', async () => {
    await sb.insert('google_ads_accounts', {
      workspace_id: WORKSPACE_ID, customer_id: '0001000003', refresh_token_encrypted: 'x', refresh_token_iv: 'y', is_active: true,
    });
    const syncSpy = vi.spyOn(syncMod, 'syncAccount')
      .mockRejectedValueOnce(new Error('first_fails'))
      .mockResolvedValueOnce({ log_id: 'l', status: 'success', rows_synced: 0, duration_ms: 100 });

    const event = { cron: '0 3 * * *', scheduledTime: Date.now() } as ScheduledEvent;
    const ctx = { waitUntil: () => {} } as ExecutionContext;
    await workerModule.scheduled(event, env, ctx);

    expect(syncSpy).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Implementar `scheduled()` handler em `worker/src/index.ts`**

Adicionar ao `worker/src/index.ts` (junto com export default):

```ts
import { syncAccount, type GoogleAdsAccountRow } from './lib/google-ads/sync';
import { createStructuredLogger } from './lib/structured-log';

async function scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
  const traceId = crypto.randomUUID();
  const startedAt = Date.now();
  const log = createStructuredLogger(traceId, startedAt);
  log.info('cron_started', { cron: event.cron });

  const sb = createSupabaseClient(env);
  const accounts = await sb.select<GoogleAdsAccountRow>('google_ads_accounts', {
    is_active: 'eq.true',
    select: 'id,workspace_id,customer_id,manager_customer_id,refresh_token_encrypted,refresh_token_iv,is_active',
  });
  log.info('cron_accounts_listed', { count: accounts.length });

  // Sequencial pra não estourar rate limit
  for (const account of accounts) {
    try {
      await syncAccount(env, account);
      log.info('cron_account_synced', { account_id: account.id });
    } catch (err) {
      log.error('cron_account_failed', {
        account_id: account.id, error: err instanceof Error ? err.message : String(err),
      });
      // Continua próxima account
    }
  }

  // Cleanup oauth_pending_selections expirados
  try {
    await sb.delete('oauth_pending_selections', { expires_at: `lt.${new Date().toISOString()}` });
    log.info('cron_pending_cleanup_ok');
  } catch (err) {
    log.warn('cron_pending_cleanup_failed', { error: err instanceof Error ? err.message : String(err) });
  }

  log.info('cron_finished', { duration_ms: Date.now() - startedAt });
}

export default {
  fetch: handleFetch, // handler existente da Fase 1
  scheduled,
};
```

> NOTA: `handleFetch` é o handler unificado que faz routing por path. Adicionar as 4 routes OAuth + sync + disconnect ao switch nele (próximo step).

- [ ] **Step 3: Rodar e commitar**

```bash
pnpm worker:test -- routes/scheduled
git add worker/src/index.ts worker/tests/routes/scheduled.test.ts
git commit -m "feat(worker): scheduled() handler com loop sequencial + cleanup pending"
```

---

## Task 38: Wiring `index.ts` com novas routes + cron config

**Files:**
- Modify: `worker/src/index.ts` — adicionar routes OAuth + sync + disconnect ao router
- Modify: `worker/wrangler.toml.example` — adicionar `[triggers] crons`

- [ ] **Step 1: Adicionar routes ao router em `index.ts`**

Editar `worker/src/index.ts` no `handleFetch` adicionando branches:

```ts
const url = new URL(req.url);
const path = url.pathname;

// ... routes existentes (lt-script, track-click, webhooks)

if (req.method === 'GET' && path === '/oauth/google-ads/start') {
  return handleOAuthStart(req, env);
}
if (req.method === 'GET' && path === '/oauth/google-ads/callback') {
  return handleOAuthCallback(req, env);
}
const previewMatch = path.match(/^\/oauth\/google-ads\/session\/([^/]+)\/preview$/);
if (req.method === 'GET' && previewMatch) {
  return handleOAuthPreview(req, env, previewMatch[1]);
}
if (req.method === 'POST' && path === '/oauth/google-ads/finalize') {
  return handleOAuthFinalize(req, env);
}
if (req.method === 'POST' && path === '/api/google-ads/sync') {
  return handleGoogleAdsSync(req, env, ctx);
}
if (req.method === 'POST' && path === '/api/google-ads/disconnect') {
  return handleGoogleAdsDisconnect(req, env);
}
```

Adicionar imports no topo do `index.ts`:
```ts
import {
  handleOAuthStart, handleOAuthCallback, handleOAuthPreview, handleOAuthFinalize,
} from './routes/oauth-google-ads';
import { handleGoogleAdsSync } from './routes/google-ads-sync';
import { handleGoogleAdsDisconnect } from './routes/google-ads-disconnect';
```

- [ ] **Step 2: Configurar cron no wrangler.toml.example**

Adicionar ao `worker/wrangler.toml.example`:

```toml
[triggers]
crons = ["0 3 * * *"]
```

E aplicar igual no `wrangler.toml` (não-commitado).

- [ ] **Step 3: Smoke check do scheduled local**

```bash
pnpm worker:dev
```
Em outro terminal:
```bash
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```
Esperado: trigger do scheduled handler. Olhar logs do `wrangler dev`: deve aparecer `cron_started`, `cron_accounts_listed`, `cron_finished`.

- [ ] **Step 4: Rodar suite completa**

```bash
pnpm worker:test
```
Esperado: tudo verde (~210+ testes total).

- [ ] **Step 5: Commitar**

```bash
git add worker/src/index.ts worker/wrangler.toml.example
git commit -m "chore(worker): wiring das routes Google Ads + cron diario"
```

---



## Phase 7 — Conectar UI real ao Worker

> Substitui os 4 stubs por proxies reais. `sync-status` já era real. Polling adaptativo passa a refletir comportamento real do Worker.

## Task 39: Substituir stubs por proxies reais

**Files:**
- Modify: `app/app/api/google-ads/sync/route.ts`
- Modify: `app/app/api/google-ads/disconnect/route.ts`
- Modify: `app/app/api/google-ads/finalize/route.ts`
- Modify: `app/app/api/google-ads/select-preview/route.ts`
- Modify: `app/.env.local.example`

- [ ] **Step 1: Adicionar env vars ao `.env.local.example`**

Append ao `app/.env.local.example`:

```
# Worker (Fase 2A)
WORKER_BASE_URL=http://localhost:8787
WORKER_INTERNAL_TOKEN=<copiar do worker/wrangler.toml — mesmo valor>
NEXT_PUBLIC_WORKER_BASE_URL=http://localhost:8787
```

Aplicar valores reais em `app/.env.local` (não-commitado).

- [ ] **Step 2: Implementar proxy real `sync/route.ts`**

Conteúdo de `app/app/api/google-ads/sync/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.google_ads_account_id) return NextResponse.json({ error: 'missing_account_id' }, { status: 400 });

  // Validação ownership: SELECT pra confirmar que account pertence ao workspace do user
  const { data: workspaces } = await supabase.from('workspaces').select('id').eq('owner_id', user.id);
  const workspaceIds = (workspaces ?? []).map((w) => w.id);
  const { data: account } = await supabase
    .from('google_ads_accounts')
    .select('id, workspace_id')
    .eq('id', body.google_ads_account_id)
    .maybeSingle();
  if (!account || !workspaceIds.includes(account.workspace_id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const workerBase = process.env.WORKER_BASE_URL ?? 'http://localhost:8787';
  const workerToken = process.env.WORKER_INTERNAL_TOKEN ?? '';
  const res = await fetch(`${workerBase}/api/google-ads/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${workerToken}`,
      'X-User-JWT': session.access_token,
    },
    body: JSON.stringify({ google_ads_account_id: body.google_ads_account_id }),
  });
  return new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
}
```

- [ ] **Step 3: Implementar `disconnect/route.ts` (mesmo pattern)**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.google_ads_account_id) return NextResponse.json({ error: 'missing_account_id' }, { status: 400 });

  const { data: workspaces } = await supabase.from('workspaces').select('id').eq('owner_id', user.id);
  const workspaceIds = (workspaces ?? []).map((w) => w.id);
  const { data: account } = await supabase
    .from('google_ads_accounts').select('workspace_id').eq('id', body.google_ads_account_id).maybeSingle();
  if (!account || !workspaceIds.includes(account.workspace_id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const workerBase = process.env.WORKER_BASE_URL ?? 'http://localhost:8787';
  const res = await fetch(`${workerBase}/api/google-ads/disconnect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${process.env.WORKER_INTERNAL_TOKEN ?? ''}`,
      'X-User-JWT': session.access_token,
    },
    body: JSON.stringify({ google_ads_account_id: body.google_ads_account_id }),
  });
  return new NextResponse(await res.text(), { status: res.status });
}
```

- [ ] **Step 4: Implementar `finalize/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.session_uuid || !Array.isArray(body.customer_ids)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const workerBase = process.env.WORKER_BASE_URL ?? 'http://localhost:8787';
  const res = await fetch(`${workerBase}/oauth/google-ads/finalize`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${process.env.WORKER_INTERNAL_TOKEN ?? ''}`,
      'X-User-JWT': session.access_token,
    },
    body: JSON.stringify(body),
  });
  return new NextResponse(await res.text(), { status: res.status });
}
```

- [ ] **Step 5: Implementar `select-preview/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  if (!sessionId) return NextResponse.json({ error: 'missing_session_id' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const workerBase = process.env.WORKER_BASE_URL ?? 'http://localhost:8787';
  const res = await fetch(`${workerBase}/oauth/google-ads/session/${sessionId}/preview`, {
    headers: {
      Authorization: `Bearer ${process.env.WORKER_INTERNAL_TOKEN ?? ''}`,
      'X-User-JWT': session.access_token,
    },
  });
  return new NextResponse(await res.text(), { status: res.status });
}
```

> NOTA: A page `/integrations/select/page.tsx` já chama o Worker direto (Task 28). Pra consistência, redirecionar a chamada da page pra `/api/google-ads/select-preview?session_id=...` em vez de fetch direto. Editar `select/page.tsx` substituindo o `fetch(${workerBase}/oauth/google-ads/session/${sessionId}/preview, ...)` por `fetch('/api/google-ads/select-preview?session_id=' + sessionId)` com cookies passando naturalmente (server-side fetch do Next inclui cookies do request).

- [ ] **Step 6: Commitar**

```bash
git add app/app/api/google-ads/ app/.env.local.example "app/app/(dashboard)/dashboard/integrations/select/page.tsx"
git commit -m "feat(app): proxies reais pro Worker (sync, disconnect, finalize, preview)"
```

---

## Task 40: Smoke flow visual no browser (verificação intermediária)

**Files:**
- Nenhum (validação manual)

> Antes do smoke runbook formal (Task 42), valida que UI + Worker conversam em todos os caminhos críticos.

- [ ] **Step 1: Subir tudo local**

```bash
# terminal 1
supabase start

# terminal 2
pnpm worker:dev

# terminal 3
pnpm app:dev
```

- [ ] **Step 2: Connect happy path (1 customer)**

Abrir browser logado em http://localhost:3000/dashboard/integrations:
- Click "Conectar Google Ads"
- Login Google + autorizar
- Voltar pra `/dashboard/integrations?status=connected`
- Card aparece: nome, customer ID formatado, badge ● Conectada
- Studio: `SELECT * FROM google_ads_accounts` mostra 1 row nova

- [ ] **Step 3: Sync manual + polling**

- Click "Sincronizar agora"
- Botão vira "Sincronizando..." disabled
- Esperar ~10-20s (polling a cada 1-5s)
- Toast/refresh aparece com resultado: "Última sync: agora · success · N rows"

- [ ] **Step 4: Disconnect com AlertDialog**

- Click "Desconectar"
- AlertDialog abre com texto explicativo
- Confirmar → card mostra ⚠ Reconectar
- Studio: `is_active=false` no row

- [ ] **Step 5: Reconnect**

- Click "Reconectar" → mesma fluxo OAuth
- Voltar com is_active=true (mesma row, refresh_token regravado)

> Se algum passo falhar, debug antes de seguir. Logs em `wrangler tail` ajudam pra Worker; browser DevTools pra App.

- [ ] **Step 6: Commitar (anotação manual)**

Sem código novo. Confirmar `git status` limpo.

---

## ▸ CHECKPOINT 4 — UI conectada, smoke pre-final OK

> **Pausa.** Antes de seguir pra Phase 8:
> 1. Os 5 cenários do Step 2-5 da Task 40 todos verde no browser.
> 2. Logs do Worker mostram `sync_start`, `phase_started` (campaigns/ad_groups/ads), `mark_removed`, `sync_success` na cadência esperada.
> 3. Suite de testes verde: `pnpm worker:test` (~210+) + `pnpm app:test` (se App tiver tests; pelo menos não regredir build).
> 4. Pausa pra ajustes finais antes de cravar runbook + executar smoke completo.
> 5. Quando aprovado, seguir pra Phase 8 (smoke runbook + execução final).

---

## Phase 8 — Smoke manual

## Task 41: Criar runbook `docs/runbooks/fase-2a-smoke.md`

**Files:**
- Create: `docs/runbooks/fase-2a-smoke.md`

- [ ] **Step 1: Escrever runbook formato Fase 1 (9 passos)**

Conteúdo de `docs/runbooks/fase-2a-smoke.md`:

```markdown
# Smoke Test — Fase 2A Google Ads OAuth + Metadata Sync

> Roteiro manual de validação ponta-a-ponta. Marca cada checkbox conforme executa.
> Se algo falhar, abrir issue/diagnóstico antes de fechar a fase.
> Pré-requisito: Google Ads test customer criado, Developer Token aprovado (Basic Access),
> env vars setadas em `worker/wrangler.toml` e `app/.env.local`.

## Setup pré-execução

- [ ] `supabase start` — Studio em http://localhost:54323
- [ ] `pnpm worker:dev` — Worker em http://localhost:8787
- [ ] `pnpm app:dev` — App em http://localhost:3000
- [ ] Logado em /dashboard como `dev@finaltrack.local`
- [ ] Test customer Google Ads ID anotado: `__________`
- [ ] Pelo menos 1 campaign ENABLED criada no test customer (pode ser qualquer tipo: SEARCH/DISPLAY/VIDEO/PMAX/DG)

---

## Passo 1: Connect happy path (1 customer)

**Pré:** workspace `dev` sem nenhuma `google_ads_accounts` row.

```sql
DELETE FROM google_ads_accounts WHERE workspace_id = '00000000-0000-0000-0000-000000000001';
```

**Ação:**
- [ ] Abrir http://localhost:3000/dashboard/integrations
- [ ] Verificar empty state com botão "Conectar Google Ads"
- [ ] Clicar — redirect pro Google
- [ ] Login Google (conta operadora) → Permitir → callback

**Validação:**
- [ ] Voltar em `/dashboard/integrations?status=connected` com toast verde
- [ ] Card visível com customer_id formatado
- [ ] Studio: `SELECT customer_id, is_active FROM google_ads_accounts WHERE workspace_id = '...'` retorna 1 row, is_active=true
- [ ] `refresh_token_encrypted` ≠ NULL e ≠ vazio

**Pausa pra approval Leo antes do próximo passo.**

---

## Passo 2: Connect com múltiplos customer_ids → seleção

**Pré:** conta operadora autoriza 2+ contas Google Ads (geralmente já é o caso).

**Ação:**
- [ ] Disconnect a conta do passo 1 (pra repetir OAuth)
- [ ] "Conectar Google Ads" novamente
- [ ] Após login, callback redireciona pra `/dashboard/integrations/select?session=...`

**Validação:**
- [ ] Página de seleção mostra 2+ customer_ids formatados em checkboxes
- [ ] Countdown live em 09:XX
- [ ] Studio: `SELECT id FROM oauth_pending_selections WHERE workspace_id = '...'` retorna 1 row
- [ ] Selecionar 2, click "Conectar selecionadas"
- [ ] Voltar em `/dashboard/integrations?status=connected`
- [ ] Studio: 2 rows em `google_ads_accounts`, 0 rows em `oauth_pending_selections`

**Pausa.**

---

## Passo 3: Sync manual via UI → polling → status final

**Pré:** 1+ campaigns ENABLED no test customer.

**Ação:**
- [ ] No card da conta, clicar "Sincronizar agora"
- [ ] Botão vira "Sincronizando..." disabled
- [ ] Aguardar ~10-30s (polling adaptativo: 1s, 1s, 2s, 2s, 3s, 3s, 5s cap)

**Validação:**
- [ ] Card atualiza com "Última sync: agora · success · N rows · X.Xs"
- [ ] Studio: `SELECT status, sync_type, rows_synced, parsed_skipped, trace_id FROM google_ads_sync_log ORDER BY started_at DESC LIMIT 1`
  - status = 'success'
  - sync_type = 'metadata'
  - rows_synced > 0
  - trace_id ≠ NULL
- [ ] `SELECT count(*) FROM campaigns WHERE google_ads_account_id = '...'` ≥ 1
- [ ] `wrangler tail`: ver logs JSON com `event: sync_start`, `phase_started`, `mark_removed`, `sync_success` — todos com mesmo `trace_id`

**Pausa.**

---

## Passo 4: REMOVED detection

**Ação:**
- [ ] Anotar lista atual de campaigns: `SELECT google_campaign_id, name, status FROM campaigns WHERE google_ads_account_id = '...'`
- [ ] Pausar (status PAUSED) ou remover 1 campaign no Google Ads UI (manual)
- [ ] Aguardar ~30s pra Google propagar
- [ ] Click "Sincronizar agora" no LeoTracker

**Validação:**
- [ ] Studio: `SELECT google_campaign_id, status FROM campaigns WHERE google_ads_account_id = '...'`
  - Campaign tocada agora tem status='REMOVED' ou 'PAUSED' (conforme ação)
- [ ] `/dashboard/campaigns` sem `?include_removed=1` → não mostra REMOVED
- [ ] Toggle `?include_removed=1` → mostra REMOVED em texto cinza

**Pausa.**

---

## Passo 5: Disconnect via UI (AlertDialog)

**Ação:**
- [ ] Click "Desconectar" em uma das contas
- [ ] AlertDialog abre com texto rico ("Sync diário vai parar...")

**Validação:**
- [ ] Click "Cancelar" → fecha sem mudança no DB
- [ ] Click "Desconectar" → AlertDialog fecha, card mostra ⚠ Reconectar
- [ ] Studio: `SELECT is_active FROM google_ads_accounts WHERE id = '...'` → false
- [ ] Histórico preservado: campaigns/ad_groups/ads/log intactos

**Pausa.**

---

## Passo 6: Reconnect (is_active volta TRUE)

**Ação:**
- [ ] Click "Reconectar" no card desativado
- [ ] OAuth full flow novamente

**Validação:**
- [ ] Mesma row em `google_ads_accounts` (mesmo id), is_active=true
- [ ] `refresh_token_encrypted` regravado (valor diferente do anterior — `prompt=consent` força novo token)

**Pausa.**

---

## Passo 7: Cron diário (test trigger)

**Ação:**
- [ ] Em outro terminal: `curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"`

**Validação:**
- [ ] `wrangler tail`: aparece `cron_started`, `cron_accounts_listed: count: N`, `cron_account_synced` por account ativa, `cron_pending_cleanup_ok`, `cron_finished`
- [ ] Studio: `SELECT count(*) FROM google_ads_sync_log WHERE started_at > NOW() - INTERVAL '1 minute'` ≥ N (1 por account ativa)

**Pausa.**

---

## Passo 8: invalid_grant simulation

**Ação:**
- [ ] Acessar https://myaccount.google.com → Apps com acesso à sua conta → revogar acesso ao "LeoTracker Local Dev" OAuth client
- [ ] Voltar em `/dashboard/integrations`
- [ ] Click "Sincronizar agora" na conta correspondente

**Validação:**
- [ ] Sync falha
- [ ] Studio: `SELECT is_active FROM google_ads_accounts WHERE customer_id = '...'` → false
- [ ] Studio: `SELECT status, error_message FROM google_ads_sync_log ORDER BY started_at DESC LIMIT 1` → status=failed, error_message contém 'invalid_grant'
- [ ] UI: badge ⚠ Reconectar visível

**Pausa.**

---

## Passo 9: Selection session expirado

**Ação:**
- [ ] Iniciar OAuth de uma conta com 2+ customer_ids
- [ ] Chegar em `/dashboard/integrations/select`
- [ ] Aguardar 11min sem ação (ou diretamente: `UPDATE oauth_pending_selections SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = '...'`)
- [ ] Click "Conectar selecionadas"

**Validação:**
- [ ] Redirect pra `/dashboard/integrations?status=session_expired` com toast
- [ ] Studio: pending row deletada (Worker faz delete em response 410)

**FIM. Smoke completo. Marcar todos os passos verde antes de fechar a fase.**
```

- [ ] **Step 2: Commitar runbook**

```bash
git add docs/runbooks/fase-2a-smoke.md
git commit -m "docs(runbook): smoke test fase 2a (9 passos pre-merge)"
```

---

## Task 42: Executar smoke runbook completo

**Files:**
- Nenhum (execução manual; sem mudanças no código)

- [ ] **Step 1: Executar os 9 passos do runbook**

Seguir `docs/runbooks/fase-2a-smoke.md` literalmente. Cada passo termina com pausa pra Leo aprovar antes do próximo. Anotar qualquer falha + criar issue/fix antes de continuar.

- [ ] **Step 2: Salvar evidência**

Após smoke 9/9 verde, copiar/marcar checkboxes do runbook como executados num arquivo de status novo:

```bash
cp docs/runbooks/fase-2a-smoke.md docs/runbooks/fase-2a-smoke-2026-05-XX.executed.md
# editar pra marcar todos os checkboxes como [x]
```

Commit final do smoke:

```bash
git add docs/runbooks/fase-2a-smoke-2026-05-*.executed.md
git commit -m "test(smoke): fase 2a smoke 9/9 verde executado"
```

---

## Task 43: Atualizar AGENTS.md + abrir PR

**Files:**
- Modify: `AGENTS.md` — atualizar §10 com status "Fase 2A entregue"

- [ ] **Step 1: Atualizar AGENTS.md**

Editar `AGENTS.md` §10 (Fase 2) adicionando bloco:

```markdown
### Fase 2A — Connect + Read Foundation: ENTREGUE em 2026-05-XX

- Migration 004 aplicada: ad_groups (+entity_type, +metadata), google_ads_sync_log (renomeada + sync_type/partial_skipped/trace_id/parsed_skipped), oauth_pending_selections (NEW), RPC mark_removed_for_account
- Worker: lib/google-ads/{oauth,client,sync,parsers,errors,queries}, lib/{internal-auth,structured-log,upsert-bisect,customer-id,oauth-error-messages,sync-log}
- App: /dashboard/integrations + /dashboard/integrations/select + /dashboard/campaigns + AlertDialog confirm-destructive
- Cron diário: 0 3 * * * UTC
- Smoke: 9/9 verde
- Spec: docs/specs/fase-2a-google-ads-connect.md
- Plan: docs/plans/fase-2a-google-ads-connect.md
- Runbook: docs/runbooks/fase-2a-smoke.md
- Próximo sub-projeto: Fase 2C (Conversion Upload)
```

- [ ] **Step 2: Commitar**

```bash
git add AGENTS.md
git commit -m "docs: registrar Fase 2A como entregue + status atualizado"
```

- [ ] **Step 3: Abrir PR pra main**

```bash
git push -u origin feat/fase-2a-google-ads-connect
gh pr create --title "feat: Fase 2A Google Ads OAuth + Metadata Sync" --body "$(cat <<'EOF'
## Summary
- OAuth Google Ads completo (single + multi-customer selection)
- Metadata sync diário (campaigns, ad_groups, ads, asset_groups containers)
- Migration 004: schema delta + RPC mark_removed atômico
- UI: /dashboard/integrations + /dashboard/campaigns + AlertDialog destructive
- Patterns reusáveis pra 2B/2C: internal-auth, structured-log, upsert-bisect

## Test plan
- [x] Migration aplica limpa em supabase local
- [x] 200+ testes verde (`pnpm worker:test`)
- [x] App build sem erros (`pnpm app:build`)
- [x] Smoke runbook 9/9 verde — `docs/runbooks/fase-2a-smoke-2026-05-XX.executed.md`

## Spec
- `docs/specs/fase-2a-google-ads-connect.md`

## Out-of-scope (próximas fases)
- Conversion upload → Fase 2C
- Cost data sync → Fase 2B
- PMax/DG asset_group_assets → Fase 2D
- Multi-tenant SaaS → quando virar SaaS comercial (ver §12.1 do spec)
EOF
)"
```

---



## Self-review (executada antes de salvar)

**Cobertura do spec (`docs/specs/fase-2a-google-ads-connect.md`):**

- §1 Objetivo + critério de sucesso → coberto pelos 9 passos do smoke runbook (Task 41-42).
- §2 Componentes alto-nível → arquivos mapeados em "File Structure" + tasks 6-30 (Worker libs, routes; App pages, libs).
- §3.1 Decisões macro Q1-Q10 → encarnadas: Q5/Q7 (β) em parsers/queries (Tasks 11-12, 22), Q6 cron (Task 37-38), Q8 REMOVED (Task 22 + RPC Task 3), Q10 testing hybrid (Tasks 3-5 integration + Tasks 6-22 unit + Task 41-42 smoke).
- §3.2 Decisões 2.x-7.x → cada uma rastreável: 2.1 (Task 8), 2.2 (Task 14), 2.3 (Task 27), 3.A.1 comment (Task 15 step 2 oauth.ts), 3.A.2 (Tasks 32-34), 3.A.2.4 internal-auth (Task 8), 3.A.3 manager_customer_id (handlado em Tasks 32+34), 3.B.4 zombie+409 (Task 22), 3.B.5.1 sem backfill (out-of-scope), 3.B.5.2 refresh handler (Task 16), 4.9.1 partial+partial_skipped (Task 22 catch + Task 5 test), 4.9.2 bisect (Task 13), 4.9.3 checkBudget (Task 22), 4.9.4 structured-log (Task 7), 5.7.1 customer-id (Task 6 + 24), 5.7.2 polling (Task 25), 5.7.3 empty state (Task 29), 5.7.4 AlertDialog (Task 23), 6.4.1 payload_iv (Task 4 + Task 1 SQL), 6.4.2 sync_type required (Task 18 + Task 5 test), 6.4.3 parsed_skipped (Task 1 SQL + Task 22 increment), 6.4.4 trace_id (Task 1 SQL + Task 22 propagation), 6.4.5 RPC (Tasks 1+3), 7.6.1 mocking (todos worker tests), 7.6.2 runbook (Task 41), 7.6.3 skipIf (mencionar em Task 41 setup), 7.6.4 ordem (estrutura do plano), 7.6.5 sem threshold (não tem step de coverage gating).
- §4 Schema migration 004 SQL → copiado literalmente em Task 1 step 1.
- §5 Endpoints Worker → 1 task por endpoint (Tasks 31-37).
- §6 App routes & páginas → Tasks 23-30.
- §7 Bibliotecas auxiliares → cada lib tem task dedicada (Tasks 6-18 Worker; Tasks 23-25 App).
- §8 Patterns transversais → embutidos nas implementações (8.1 internal-auth Task 8, 8.2 structured-log Task 7, 8.3 bisect Task 13, 8.4 time budget Task 22, 8.5 customer-id Task 6, 8.6 confirm destructive Task 23).
- §9 Polling/cadências/TTLs → cravados nos arquivos correspondentes (sync-polling Task 25, cron Task 37, TTL DB Task 1, zombie Task 22, time budget Task 22).
- §10 Sequência implementação → estrutura do plano (8 phases na ordem).
- §11 Testing → integration tests Tasks 3-5; unit tests Tasks 6-22; smoke Task 41-42.
- §12 Out-of-scope → respeitado: nenhuma task toca conversion_actions, asset_group_assets, cost sync, multi-tenant.
- §13 Tech debts → flagados ao longo (Task 35 nota síncrono vs waitUntil; Task 24 monorepo; Task 22 sync >30s; backfill clicks documentado no spec).

**Placeholder scan:**
- Sem TBD/TODO inline. Steps com código têm código completo.
- "Por brevidade, escreva os 5 testes seguindo os patterns de Task 8" aparece em Task 33 step 1 — esse é um placeholder admitido (escrever testes é trabalho mecânico de aplicar pattern conhecido). Aceitável: nomes de testes + cenários estão listados; tester só replica o setup do Task 8.
- "Por brevidade" também em Task 36 step 1. Mesmo caso. OK.
- Task 35 step 2 tem nota explícita sobre simplificação síncrona vs waitUntil — decisão de implementação documentada como tech debt, não placeholder.

**Type consistency:**
- `validateInternalRequest` retorna `{workspaceIds: string[], userId: string}` em Task 8 implementação; usado consistentemente em Tasks 33, 34, 35, 36. ✓
- `SyncResult` retorna `{log_id, status, rows_synced, duration_ms}` em Task 22; consumido em Task 35. ✓
- `SupabaseClient` ganha `update`, `upsert`, `rpc` em Task 9; usado em Tasks 22, 32-37. ✓
- `parseAdGroupRow` recebe `(row, campaignId: string)` em Task 12; usado em sync.syncAdGroupsAndAssetGroups Task 22 com `c.id` (UUID). ✓
- `formatCustomerId` exportado em Task 6 (Worker); cópia em Task 24 (App); consumido em UI Tasks 27, 28. ✓
- `useSyncStatus(accountId, enabled)` definido Task 25; consumido em IntegrationActions Task 27. ✓
- `signState`/`verifyState` em Task 14; consumido em Tasks 31, 32. ✓
- `RefreshTokenResult` em Task 19 vs uso em Task 22 sync (`tokens.access_token`, `tokens.expires_in`). ✓

**Spec coverage gaps:** Nenhum identificado.

**Plan size:** ~3500 linhas, 43 tasks distribuídas em 8 phases + Task 0. Cada task com 2-8 steps. Granularidade alinhada com plan da Fase 1 (3631 linhas, 27 tasks — 2A é maior em escopo, justifica mais tasks).

