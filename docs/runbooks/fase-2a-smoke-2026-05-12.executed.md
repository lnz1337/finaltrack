# Smoke Test Fase 2A — Execução 2026-05-12 (PARCIAL)

> Cópia executada de `fase-2a-smoke.md`. Passos 1-5 ✅ validados visualmente por Leo.
> Passos 6-9 ⚠️ BLOQUEADO — `googleAdsSearch` rejeitado pelo Test Developer Token
> (`DEVELOPER_TOKEN_NOT_APPROVED`). **Basic Access submetido ao Google em 2026-05-12**
> (3-5 dias úteis). Diagnóstico: ver patch P14 (`sync_failed` com `error_message` —
> commit `231db98`) e `docs/plans/phase-1-status.md` § "bugs de estado-externo".

## Resultado por passo

| # | Passo | Status | Nota |
|---|---|---|---|
| 1 | Connect happy path (1 customer) | ✅ | callback OK; card com `customer_id` formatado; `account_name = "Conta XXX-XXX-XXXX"` (decisão 3.A.2.5); `refresh_token_encrypted` gravado |
| 2 | Connect multi → seleção | ✅ | `/integrations/select` lista 2+ customers em checkboxes; countdown live; `oauth_pending_selections` criada/deletada; `finalize_accounts_created` no log |
| 3 | Selection session expirado | ✅ | resposta 410 → redirect `?status=session_expired`; pending deletada; sem `internal_auth_failed` (decode-without-verify do `X-User-JWT` OK — Opção C) |
| 4 | Disconnect via AlertDialog | ✅ | shadcn AlertDialog (não `window.confirm`, decisão 5.7.4); Cancelar = no-op; Desconectar → `is_active=false`; histórico preservado |
| 5 | Reconnect (is_active → TRUE) | ✅ | mesma row (`UNIQUE(workspace_id, customer_id)`); `is_active=true`; `refresh_token_encrypted` regravado |
| 6 | Sync manual via UI → polling → status | ⚠️ BLOQUEADO | `googleAdsSearch` → `DEVELOPER_TOKEN_NOT_APPROVED`. Aguarda Basic Access |
| 7 | REMOVED detection | ⚠️ BLOQUEADO | depende do Passo 6 |
| 8 | Cron diário (test trigger) | ⚠️ BLOQUEADO | `syncAccount` por account falha sem token aprovado |
| 9 | invalid_grant simulation | ⚠️ BLOQUEADO | precisa de sync após revoke |

## Validado adicional (Checkpoint 3 + 4)

- ✅ Phase 5 visual: `formatCustomerId` no `/dashboard/campaigns` (patch P9), polling adaptativo (1s,1s,2s,2s,3s,3s,5s cap, timeout 60s — decisão 5.7.2), memory-leak prevention no polling (cleanup on unmount / status != running)
- ✅ Error handling estruturado (decisão 4.9.4): `callback_step_failed` / `finalize_step_failed` / `sync_failed` com `step`/`error_message`/`error_stack`/`error_type`
- ✅ JWT `X-User-JWT` decode-without-verify (Opção C — Supabase usa ES256/JWKS, `WORKER_INTERNAL_TOKEN` é primary auth); `internal_auth_failed` log estruturado

## Patches aplicados durante o smoke (P9-P14)

| P | O quê | Commit(s) |
|---|---|---|
| P9 | `formatCustomerId` na coluna "Conta" do `/dashboard/campaigns` | `~2004` |
| P10 | Test isolation: `afterAll` cleanup em `google_ads_sync_log` | (committed) |
| P11 | `account_name` default `"Conta " || formatCustomerId(customer_id)` (decisão 3.A.2.5) — callback + finalize | (committed) |
| P12 | Fix regressão do P10: cleanup com UUID random por execução (não hardcoded) + `setup-dev.sh` re-seed das 3 dev accounts | 2 commits |
| P13 | Google Ads API v17 (sunsetted, 404) → v23; versão pinada em `constants.ts`; structured logging no OAuth callback | `db09c46`, `494ba9a` |
| P14 | `X-User-JWT` decode-without-verify (Opção C; ES256 ≠ HS256); `SUPABASE_JWT_SECRET` removido; `internal_auth_failed` log; `sync_failed` com `error_message/type/stack` | `d6da4ee`, `27d9893`, `231db98` |

## Meta-patterns → tech debt arquitetural (em `docs/plans/phase-1-status.md`)

1. Brainstorm de fase que toca API externa deve validar **estado atual da API** (versão, esquema de auth, formato de token) antes de cravar valores no spec — custou P13 (v17 sunsetted) e P14 (ES256 vs HS256).
2. JWT verification simplificada pra decode-without-verify — migrar pra JWKS verify real (lib `jose` + cache do endpoint) pre-prod.
3. Duplicação App↔Worker (customer-id, oauth-error-messages) — virar `packages/shared` na 4ª duplicação.

## Próximo passo

PR aberto em **DRAFT** — permanece draft até Passos 6-9 verdes pós-aprovação Basic Access.
Retomada documentada em `fase-2a-smoke.md` § "Como retomar Passos 6-9".
