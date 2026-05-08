# Handoff: Fase 2A pré-execução — 2026-05-07

> Spec aprovado, plan aprovado, branch criada. Próxima sessão = arrancar
> execução via `superpowers:subagent-driven-development`.

## Contexto

Fase 2A (Google Ads OAuth + Metadata Sync) saiu do brainstorm de
2026-05-07 (sessão `b1366075-57d5-4361-b98b-5bb9dfbe2c0a` continuada).
Spec consolidado, plan detalhado, ambos commitados e pushed.

## Estado do repositório

- **Branch ativa:** `main` (working tree clean)
- **main HEAD:** `f79bffa docs(plan): Fase 2A Google Ads Connect + Read Foundation - plano de implementacao`
- **Commits desta sessão:**
  - `7afe3a7` — handoff brainstorm Seção 1 (commit anterior, prefacio)
  - `47a3080` — spec Fase 2A consolidado (`docs/specs/fase-2a-google-ads-connect.md`, 720 linhas)
  - `f79bffa` — plan Fase 2A detalhado (`docs/plans/fase-2a-google-ads-connect.md`, 5894 linhas)
- **Branches preservadas:** `feat/fase-1-click-capture`, `feat/payt-integration`, `feat/dashboard-test-filter`
- **Branch da Fase 2A:** **NÃO criada ainda.** Task 0 do plano cria `feat/fase-2a-google-ads-connect`.

## Artefatos prontos

| Doc | Path | Linhas | Status |
|---|---|---|---|
| Brainstorm Seção 1 (handoff antigo) | `docs/handoffs/2026-05-07-fase-2a-brainstorm.md` | 158 | Commitado `7afe3a7` |
| Spec consolidado | `docs/specs/fase-2a-google-ads-connect.md` | 720 | Commitado `47a3080` |
| Plan de implementação | `docs/plans/fase-2a-google-ads-connect.md` | 5894 | Commitado `f79bffa` |

## Decisões cravadas (resumo executivo)

Todas detalhadas em §3.1-3.2 do spec. Highlights:

- **Single-tenant** (decisão Q3): Leo usa Basic Access do developer token; "multi-account" ≠ "multi-tenant SaaS" (§12.1 do spec explicita pré-requisitos pra virar SaaS).
- **OAuth híbrido**: App = UI; Worker = OAuth + API. State CSRF via cookie HMAC (sem KV).
- **Multi-customer flow**: pending session em Postgres (`oauth_pending_selections`), seleção via `/dashboard/integrations/select`.
- **Schema delta** (Migration 004): ad_groups (+entity_type/+metadata), cost_sync_log → google_ads_sync_log (+sync_type/+partial_skipped/+trace_id/+parsed_skipped + status='partial'), oauth_pending_selections (NEW), RPC mark_removed_for_account.
- **Asset_groups β**: importa containers como ad_groups com entity_type='ASSET_GROUP', SEM asset_group_assets (Fase 2D).
- **Cron**: `0 3 * * *` UTC, sequencial, +cleanup oauth_pending expirados.
- **UI patterns**: shadcn AlertDialog pra destructive (NUNCA `confirm()`); polling adaptativo 1s,1s,2s,2s,3s,3s,5s cap, timeout 60s.
- **Auth interno**: shared `WORKER_INTERNAL_TOKEN` + `X-User-JWT` (`validateInternalRequest` retorna `workspaceIds[]`).

## Sequência de execução (8 phases + 4 checkpoints)

Conforme `docs/plans/fase-2a-google-ads-connect.md` §10 do spec:

1. **Phase 1** — Migration 004 + 3 integration tests → ▸ CHECKPOINT 1
2. **Phase 2** — Libs leaf A (customer-id, structured-log, internal-auth, supabase update/upsert)
3. **Phase 3** — Libs leaf B (errors, queries, parsers, oauth, oauth-state, refresh-handler, sync-log helper)
4. **Phase 4** — Libs top (client + sync orchestrator) → ▸ CHECKPOINT 2
5. **Phase 5** — App UI stub + AlertDialog + 5 route handlers → ▸ CHECKPOINT 3
6. **Phase 6** — Worker routes (4 OAuth + 2 API + scheduled)
7. **Phase 7** — Conectar UI real (substituir stubs por proxies) → ▸ CHECKPOINT 4
8. **Phase 8** — Smoke runbook 9 passos + AGENTS.md + PR

## Pré-requisitos antes de arrancar Task 0

Antes de invocar `subagent-driven-development`, Leo precisa ter:

- [ ] **OAuth Client criado no Google Cloud Console** (Task 0 step 4)
  - Application type: Web application
  - Name: `LeoTracker Local Dev`
  - Authorized redirect URI: `http://localhost:8787/oauth/google-ads/callback`
  - Anotar `GOOGLE_ADS_CLIENT_ID` + `GOOGLE_ADS_CLIENT_SECRET`
- [ ] **Developer Token solicitado** (Task 0 step 5) — pode estar pendente (~3-5 dias review). Test customer ID anotado pra dev enquanto não aprova.
- [ ] **Arquivo local** `.notes-fase-2a.local.md` com IDs anotados (pré-Task 0 step 6).
- [ ] **Supabase local rodando** (`supabase start`) — confirmar antes de Task 0 step 3.
- [ ] **156 testes Worker verde** (Fase 1 baseline) antes de mexer em qualquer coisa.

## Próxima sessão — primeiro prompt sugerido

> "Retomar Fase 2A. Lê `docs/handoffs/2026-05-07-fase-2a-pre-execucao.md`,
> confirma pré-requisitos comigo, e arranca execução do plano via
> `superpowers:subagent-driven-development` a partir da Task 0 de
> `docs/plans/fase-2a-google-ads-connect.md`."

Alternativa pra execução inline (sem subagent):

> "Retomar Fase 2A. Em vez de subagent-driven, executa inline com
> `superpowers:executing-plans` parando em cada CHECKPOINT (1, 2, 3, 4)."

## Tasks abertas no TaskList desta sessão

Todas as 10 tasks da TaskList estão `completed`. Próxima sessão começa do zero.

## Lembretes operacionais

- Cada task termina com commit explícito (`git add <files>` + `git commit -m`); plano usa Conventional Commits PT-BR.
- Checkpoints são pausas reais — Leo aprova antes do próximo phase. Pattern Fase 1+Payt funcionou (12/12 smoke verde).
- Phase 8 (smoke) é OBRIGATÓRIO antes do PR. Não pular.
- Out-of-scope explícito (§12 do spec): nenhum task pode introduzir conversion_actions sync, asset_group_assets, cost data, ou multi-tenant. Se subagent propor, rejeitar.

## Tech debts já flagados pra resolver depois (não na 2A)

- Sync >30s não cabe (>200 campaigns): refatorar pra Cloudflare Queues
- Backfill `clicks.google_campaign_id` pré-sync: UPDATE manual na 2B
- Refresh access_token cache: KV se cron com N>>1 accounts
- `oauth-error-messages.ts` duplicado App+Worker: monorepo shared package quando virar 4ª duplicação (memory `project_monorepo_shared_trigger.md` rastreia)
- `mark_removed_for_account` RPC `IN (SELECT)`: profile + CTE WITH se degradar
- Smoke regression automation: script Node quando smoke virar regression test
