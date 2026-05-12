# Smoke Test — Fase 2A: Google Ads OAuth + Connect + Metadata Sync

> Roteiro manual de validação ponta-a-ponta. Marca cada checkbox conforme executa.
> Se algo falhar, abrir issue/diagnóstico antes de fechar a fase.
>
> **Estado (2026-05-12):** Passos 1-5 ✅ validados. Passos 6-9 ⚠️ **BLOQUEADO** —
> dependem de `googleAdsSearch`, que o **Test Developer Token** rejeita com
> `DEVELOPER_TOKEN_NOT_APPROVED`. **Basic Access submetido ao Google em 2026-05-12**
> (3-5 dias úteis pra aprovação). Ver `## Como retomar Passos 6-9` no fim deste doc.

## Pré-requisitos

- [ ] OAuth Client GCP configurado (`GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET`)
- [ ] Developer Token — **Basic Access aprovado** (test level NÃO é suficiente pros Passos 6-9)
- [ ] `worker/.dev.vars` (ou `wrangler.toml`) com: `GOOGLE_ADS_CLIENT_ID/SECRET/DEVELOPER_TOKEN`, `GOOGLE_ADS_OAUTH_REDIRECT_URI`, `APP_BASE_URL`, `WORKER_INTERNAL_TOKEN`, `ENCRYPTION_KEY`, `SUPABASE_URL/SERVICE_ROLE_KEY`
- [ ] `app/.env.local` com: `WORKER_BASE_URL`, `WORKER_INTERNAL_TOKEN` (mesmo valor do worker), `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`
- [ ] (Passos 6-9) Pelo menos 1 campaign ENABLED criada no customer alvo (qualquer tipo: SEARCH/DISPLAY/VIDEO/PMAX/DG)

## Setup pré-execução

- [ ] `supabase start` — Studio em http://localhost:54323
- [ ] `bash scripts/setup-dev.sh` (re-seed obrigatório se rodou `supabase db reset`)
- [ ] `pnpm worker:dev` — Worker em http://localhost:8787
- [ ] `pnpm app:dev` — App em http://localhost:3000
- [ ] Logado em /dashboard como `dev@finaltrack.local`
- [ ] Customer Google Ads ID anotado: `__________`

---

## Passo 1: Connect happy path (1 customer) ✅

**Pré:** workspace `dev` sem nenhuma `google_ads_accounts` row real (as 3 seed dev podem ficar).

```sql
DELETE FROM google_ads_accounts
WHERE workspace_id = '00000000-0000-0000-0000-000000000001'
  AND customer_id NOT IN ('1112223333','4445556666','7778889999'); -- preserva seed dev
```

**Ação:**
- [ ] Abrir http://localhost:3000/dashboard/integrations
- [ ] Empty state (ou só seed) com botão "Conectar Google Ads"
- [ ] Clicar → redirect pro Google (cookie `lt_oauth_state` setado)
- [ ] Login Google (conta operadora) → Permitir → callback

**Validação:**
- [ ] Volta em `/dashboard/integrations?status=connected` com toast verde
- [ ] Card visível com `customer_id` **formatado** `XXX-XXX-XXXX` (decisão 5.7.1)
- [ ] `account_name` = `Conta XXX-XXX-XXXX` (decisão 3.A.2.5)
- [ ] Studio: `SELECT customer_id, account_name, is_active FROM google_ads_accounts WHERE workspace_id='...'` → 1 row nova, `is_active=true`
- [ ] `refresh_token_encrypted` ≠ NULL e ≠ vazio; `refresh_token_iv` ≠ NULL

> Se cair em `?status=oauth_error&reason=db_error` ou `...&reason=...` — checar `wrangler tail` por `callback_step_failed` (log estruturado, decisão 4.9.4) com `step` + `error_message` + `error_stack`.

**Pausa pra approval Leo.**

---

## Passo 2: Connect com múltiplos customer_ids → seleção ✅

**Pré:** conta operadora autoriza 2+ contas Google Ads.

**Ação:**
- [ ] Desconectar a conta do Passo 1 (AlertDialog → "Desconectar")
- [ ] "Conectar Google Ads" de novo
- [ ] Após login, callback redireciona pra `/dashboard/integrations/select?session=<uuid>`

**Validação:**
- [ ] Página de seleção mostra 2+ `customer_ids` formatados em checkboxes
- [ ] Countdown live (≈09:5x decrementando)
- [ ] Studio: `SELECT id, expires_at FROM oauth_pending_selections WHERE workspace_id='...'` → 1 row, `expires_at ≈ NOW()+10min`
- [ ] Selecionar 2, clicar "Conectar selecionadas"
- [ ] Volta em `/dashboard/integrations?status=connected`
- [ ] Studio: 2 rows novas em `google_ads_accounts`; 0 rows em `oauth_pending_selections` (deletada no finalize)
- [ ] `wrangler tail`: `finalize_accounts_created` com `accounts_created: 2`

**Pausa.**

---

## Passo 3: Selection session expirado ✅

**Ação:**
- [ ] Iniciar OAuth de uma conta com 2+ `customer_ids` → chegar em `/dashboard/integrations/select`
- [ ] `UPDATE oauth_pending_selections SET expires_at = NOW() - INTERVAL '1 minute' WHERE workspace_id='...';` (ou esperar 11min)
- [ ] Recarregar a página de seleção / clicar "Conectar selecionadas"

**Validação:**
- [ ] Redirect pra `/dashboard/integrations?status=session_expired` com toast (ou erro inline na page no preview 410)
- [ ] Studio: pending row deletada (Worker deleta em resposta 410)
- [ ] `wrangler tail`: nenhum `internal_auth_failed` — auth do `/preview` passou (decode-without-verify do `X-User-JWT`, `WORKER_INTERNAL_TOKEN` é primary auth)

**Pausa.**

---

## Passo 4: Disconnect via UI (AlertDialog) ✅

**Pré:** ≥1 conta `is_active=true`.

**Ação:**
- [ ] Clicar "Desconectar" num card de conta ativa
- [ ] AlertDialog (shadcn — **não** `window.confirm`, decisão 5.7.4) abre com texto rico ("Sync diário vai parar… histórico preservado…")

**Validação:**
- [ ] Clicar "Cancelar" → fecha, sem mudança no DB
- [ ] Clicar "Desconectar" → AlertDialog fecha, card mostra badge ⚠ Reconectar
- [ ] Studio: `SELECT is_active FROM google_ads_accounts WHERE id='...'` → `false`
- [ ] Histórico preservado: rows de `campaigns`/`ad_groups`/`ads`/`google_ads_sync_log` intactas

**Pausa.**

---

## Passo 5: Reconnect (is_active volta TRUE) ✅

**Ação:**
- [ ] Clicar "Reconectar" no card desativado → OAuth full flow de novo

**Validação:**
- [ ] **Mesma row** em `google_ads_accounts` (mesmo `id`), `is_active=true` (upsert por `UNIQUE(workspace_id, customer_id)`)
- [ ] `refresh_token_encrypted` regravado (valor diferente do anterior — `prompt=consent` força novo token)

**Pausa.**

---

## ⚠️ Passos 6-9 — BLOQUEADO (aguarda Basic Access aprovado)

> **Por quê:** todos abaixo executam `googleAdsSearch` (GAQL contra a Google Ads API).
> O **Test Developer Token** só funciona contra *test accounts* — contra qualquer customer
> real a API retorna `DEVELOPER_TOKEN_NOT_APPROVED`. Diagnóstico cravado via log estruturado
> `sync_failed` (`error_message` revelado pelo patch P14 — ver `docs/plans/phase-1-status.md`).
> **Basic Access submetido ao Google em 2026-05-12.** Quando aprovar, executar 6-9 e fechar a fase.

---

## Passo 6: Sync manual via UI → polling → status final ⚠️ BLOQUEADO

**Pré:** ≥1 campaign ENABLED no customer; Basic Access aprovado.

**Ação:**
- [ ] No card da conta, clicar "Sincronizar agora"
- [ ] Botão vira "Sincronizando..." disabled
- [ ] Aguardar ~10-30s (polling adaptativo: 1s, 1s, 2s, 2s, 3s, 3s, 5s cap; timeout 60s — decisão 5.7.2)

**Validação:**
- [ ] Card atualiza: "Última sync: agora · success · N rows · X.Xs"
- [ ] Studio: `SELECT status, sync_type, rows_synced, parsed_skipped, trace_id FROM google_ads_sync_log ORDER BY started_at DESC LIMIT 1` → `success`, `metadata`, `rows_synced>0`, `trace_id≠NULL`
- [ ] `SELECT count(*) FROM campaigns WHERE google_ads_account_id='...'` ≥ 1
- [ ] `wrangler tail`: JSON logs `sync_start` → `access_token_refreshed` → `mark_removed` → `sync_success`, todos com o mesmo `trace_id`

**Pausa.**

---

## Passo 7: REMOVED detection ⚠️ BLOQUEADO (depende do Passo 6)

**Ação:**
- [ ] Anotar campaigns atuais: `SELECT google_campaign_id, name, status FROM campaigns WHERE google_ads_account_id='...'`
- [ ] No Google Ads UI: pausar (PAUSED) ou remover (REMOVED) 1 campaign
- [ ] Aguardar ~30s pra Google propagar
- [ ] Clicar "Sincronizar agora" no LeoTracker

**Validação:**
- [ ] Studio: a campaign tocada agora tem `status='REMOVED'` (ou `'PAUSED'`) — via RPC `mark_removed_for_account`
- [ ] `/dashboard/campaigns` sem `?include_removed=1` → não mostra REMOVED
- [ ] `/dashboard/campaigns?include_removed=1` → mostra REMOVED em texto cinza
- [ ] `wrangler tail`: `mark_removed` com `campaigns_marked` ≥ 1

**Pausa.**

---

## Passo 8: Cron diário (test trigger) ⚠️ BLOQUEADO (sync por account falha sem token)

**Ação:**
- [ ] Em outro terminal: `curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"`

**Validação:**
- [ ] `wrangler tail`: `cron_started` → `cron_account_synced` por account ativa → `cron_pending_cleanup_ok` → `cron_finished`; uma falha de account não bloqueia as próximas
- [ ] Studio: `SELECT count(*) FROM google_ads_sync_log WHERE started_at > NOW() - INTERVAL '1 minute'` ≥ N (1 por account ativa)
- [ ] Studio: `SELECT count(*) FROM oauth_pending_selections WHERE expires_at < NOW()` → 0 (cleanup rodou)

**Pausa.**

---

## Passo 9: invalid_grant simulation ⚠️ BLOQUEADO (precisa sync após revoke)

**Ação:**
- [ ] https://myaccount.google.com → "Apps com acesso à sua conta" → revogar acesso ao OAuth client do LeoTracker
- [ ] Voltar em `/dashboard/integrations` → "Sincronizar agora" na conta correspondente

**Validação:**
- [ ] Sync falha
- [ ] Studio: `SELECT is_active FROM google_ads_accounts WHERE customer_id='...'` → `false` (classifyRefreshError → `mark_inactive`)
- [ ] Studio: `SELECT status, error_message FROM google_ads_sync_log ORDER BY started_at DESC LIMIT 1` → `failed`, `error_message` contém `invalid_grant`
- [ ] `wrangler tail`: `account_marked_inactive` com `reason: invalid_grant` + `sync_failed`
- [ ] UI: badge ⚠ Reconectar

**FIM. Smoke completo quando 9/9 verde.**

---

## Como retomar Passos 6-9 (pós-aprovação Basic Access)

1. Conferir e-mail do Google API Center confirmando **Basic Access** no Developer Token (ou test customer aprovado).
2. Atualizar `GOOGLE_ADS_DEVELOPER_TOKEN` em `worker/.dev.vars` se o token mudou.
3. `pnpm worker:dev` (restart) + `pnpm app:dev` + Supabase up.
4. Garantir ≥1 campaign ENABLED no customer alvo.
5. Executar Passos 6 → 7 → 8 → 9 em ordem; copiar este arquivo pra `fase-2a-smoke-<data>.executed.md` com os checkboxes preenchidos.
6. Atualizar `docs/plans/phase-1-status.md` (remover o bloqueio dos Passos 6-9) e tirar o PR de DRAFT pra ready-for-review.
