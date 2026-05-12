# Handoff — Fase 2A fechamento parcial (2026-05-12)

> Também serve como **corpo do PR DRAFT**. Para abrir o PR:
> ```bash
> gh pr create --draft \
>   --title "feat(fase-2a): Google Ads OAuth + Connect + Metadata Sync (smoke parcial — aguarda Basic Access aprovado)" \
>   --body-file docs/handoffs/2026-05-12-fase-2a-fechamento-parcial.md
> ```
> (branch `feat/fase-2a-google-ads-connect` já está pushada pra `origin`.)

## Estado

**Fase 2A — Google Ads OAuth + Metadata Sync: entregue, smoke parcial.** PR fica em **DRAFT** até o smoke 9/9 verde — Passos 6-9 do runbook bloqueados por `DEVELOPER_TOKEN_NOT_APPROVED`. **Basic Access submetido ao Google em 2026-05-12** (3-5 dias úteis pra aprovação).

- ✅ Phase 7 OAuth (~90% validada visualmente): Connect single + multi-customer com seleção; `account_name` default `"Conta XXX-XXX-XXXX"` (decisão 3.A.2.5); JWT `X-User-JWT` decode-without-verify (Opção C — Supabase usa ES256/JWKS, `WORKER_INTERNAL_TOKEN` é primary auth); AlertDialog destructive funcional; Disconnect funcional; error handling estruturado (decisão 4.9.4)
- ✅ Phase 5 visual (Checkpoint 3): `formatCustomerId`, AlertDialog, polling adaptativo (decisão 5.7.2), memory-leak prevention no polling
- ✅ Sync orchestrator funcional — **258/258 testes verde**
- ⚠️ Sync real (`googleAdsSearch` contra qualquer customer): Test Developer Token rejeita non-test customers → `DEVELOPER_TOKEN_NOT_APPROVED`. Bloqueia Passos 6-9 (sync manual, REMOVED detection, cron, invalid_grant)

## O que entra neste PR

- **Worker:** rotas OAuth (`/oauth/google-ads/start|callback|session/:uuid/preview|finalize`), `/api/google-ads/sync|sync-status|disconnect`, `scheduled()` cron `0 3 * * *` + cleanup de pending; orchestrator `syncAccount` (zombie cleanup, time budget, REMOVED via RPC `mark_removed_for_account`, classifyRefreshError); cliente Google Ads API v23; `internal-auth.ts` (decode-without-verify + workspace lookup); structured logging (decisão 4.9.4)
- **App:** `/dashboard/integrations` (states + connect/sync/disconnect), `/dashboard/integrations/select` (checkboxes + countdown), `/dashboard/campaigns` (lista flat + filtro REMOVED), proxies `api/google-ads/*` (injetam `WORKER_INTERNAL_TOKEN` server-side), hook de polling adaptativo, shadcn AlertDialog
- **Schema:** migrations Fase 2A (`google_ads_accounts`, `oauth_pending_selections`, `google_ads_sync_log`, RPC `mark_removed_for_account`, partial index ASSET_GROUP)
- **Dev:** `scripts/setup-dev.sh` seeda 3 `google_ads_accounts` dev
- **Docs:** spec + plan Fase 2A, `docs/runbooks/fase-2a-smoke.md` (9 passos), `fase-2a-smoke-2026-05-12.executed.md`, AGENTS.md (endpoints + ADRs 009-011), `phase-1-status.md` (tech debts)

## Patches durante o smoke (P9-P14)

| P | O quê | Commit(s) |
|---|---|---|
| P9 | `formatCustomerId` na coluna "Conta" do `/dashboard/campaigns` | `863c5bb` |
| P10 | Test isolation: `afterAll` cleanup em `google_ads_sync_log` | `0f004af` |
| P11 | `account_name` default `"Conta " || formatCustomerId(customer_id)` (decisão 3.A.2.5) | `b4a92c3` |
| P12 | Fix regressão do P10: cleanup com UUID random por execução + `setup-dev.sh` re-seed | `6d71364`, `275edf3` |
| P13 | Google Ads API v17 (sunsetted, 404) → v23, versão pinada em `constants.ts`; structured logging no OAuth callback | `db09c46`, `fc5952d`, `494ba9a` |
| P14 | `X-User-JWT` decode-without-verify (Opção C); `SUPABASE_JWT_SECRET` removido; `internal_auth_failed` log; `sync_failed` com `error_message/type/stack` | `d6da4ee`, `27d9893`, `231db98` |

## Meta-patterns → tech debt arquitetural (`docs/plans/phase-1-status.md`)

1. **Validar estado atual de APIs externas** no brainstorm de cada fase (versão da API, esquema de auth, formato de token) antes de cravar no spec — P13 (v17 sunsetted) e P14 (ES256 ≠ HS256) custaram um ciclo de smoke cada.
2. **JWT verification simplificada** (decode-without-verify) — migrar pra JWKS verify real (lib `jose` + cache do endpoint) pre-prod.
3. **Duplicação App↔Worker** (`customer-id`, `oauth-error-messages`) — virar `packages/shared` na 4ª duplicação (hoje N=2).

Outros tech debts registrados: D8 AlertDialog overlay-to-close (cosmético), D9 `window.alert()` no fail de sync (viola decisão 5.7.4), D10 `select/page.tsx` bypassa o proxy do App, D11 RPC `mark_removed_for_account` com `IN(SELECT)` pode degradar com 10K+ ads, D7 cobertura de branches do orchestrator sem tests dedicados.

## Próximo passo (pós-aprovação Basic Access)

Executar Passos 6-9 do runbook (`docs/runbooks/fase-2a-smoke.md` § "Como retomar Passos 6-9"), atualizar `phase-1-status.md` removendo o bloqueio, tirar o PR de DRAFT → ready-for-review.

## Test plan
- [x] `pnpm worker:test` — 258/258 verde
- [x] Smoke Passos 1-5 (Connect single/multi, expired session, Disconnect AlertDialog, Reconnect) — validado visualmente
- [ ] Smoke Passos 6-9 (sync manual, REMOVED detection, cron, invalid_grant) — **BLOQUEADO** aguardando Basic Access aprovado
