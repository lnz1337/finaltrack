# Handoff Fase 1 — Cleanup + Auditoria + Merge

**Data da sessão anterior:** 2026-05-04  
**Branch:** `feat/fase-1-click-capture`  
**Status:** Smoke test 12/12 ✅ aprovado. Pronto pra cleanup + auditoria + merge.

---

## Contexto rápido

Fechei Step 10 (login + dashboard via magic link), Step 11 (RLS), Step 12 (aprovação) numa sessão longa. 6 bugs encadeados resolvidos (documentados na seção "Gotchas descobertos" abaixo). Não fiz commit ainda.

Diff atual: 6 arquivos modificados, 1 pasta untracked.

modified:   app/app/auth/callback/route.ts
modified:   app/app/login/page.tsx
modified:   app/lib/supabase/client.ts
modified:   app/lib/supabase/server.ts
modified:   app/next.config.ts
modified:   supabase/config.toml
untracked:  supabase/snippets/

---

## Tarefas (em ordem de execução)

### 1. Cleanup obrigatório antes de commit

- [ ] Remover `console.log` de debug em `app/lib/supabase/server.ts` (3 ocorrências em `getAll`, `setAll`)
- [ ] Remover `console.log` de debug em `app/app/auth/callback/route.ts` (5 ocorrências). Manter o `console.log` no catch de erro real (se tiver)
- [ ] Verificar se `supabase/snippets/` deve ir pro `.gitignore` (provavelmente sim — Studio salva snippets locais lá). Roda `ls supabase/snippets/` pra confirmar conteúdo, decide
- [ ] Apagar arquivos de backup criados durante diagnóstico:
```bash
  rm -f app/app/login/page.tsx.bak app/next.config.ts.bak supabase/config.toml.bak supabase/config.toml.bak2
```
- [ ] Limpar users de teste do banco:
```bash
  docker exec -i supabase_db_FinalTrack psql -U postgres <<'EOF'
  DELETE FROM auth.users WHERE email IN ('test-curl@finaltrack.local', 'test2@finaltrack.local', 'outro@finaltrack.local');
  SELECT email FROM auth.users;
  EOF
```
  Esperado: só `dev@finaltrack.local` sobra.

### 2. Documentar gotchas em `docs/plans/phase-1-status.md`

Adicionar seção "Gotchas Fase 1 descobertos no smoke test" com os 6 bugs:

1. **`supabase/config.toml` — `additional_redirect_urls` rejeita silenciosamente.** Default era `https://127.0.0.1:3000` (https sem path). Fix: `["http://127.0.0.1:3000/**", "http://localhost:3000/**"]`. Sintoma: magic link redirecionava pra raiz em vez do callback.

2. **Inbucket SMTP trava mesmo com healthcheck verde.** Healthcheck só testa porta HTTP (8025), não SMTP (2500). Fix: `docker restart supabase_inbucket_FinalTrack`. Sintoma: GoTrue retorna 504 timeout em `/auth/v1/otp` após criar o user no Postgres.

3. **Next 16 bloqueia HMR cross-origin entre `127.0.0.1` e `localhost`.** Fix: `allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.0.8']` em `next.config.ts`. Sintoma: WebSocket HMR falha com `ERR_INVALID_HTTP_RESPONSE`, submit do form não dispara nada visível.

4. **`new URL(request.url).origin` em route handler do Next 16 normaliza `127.0.0.1` → `localhost`.** Fix: usar `process.env.NEXT_PUBLIC_SITE_URL` como origin canônico no callback. Sintoma: cookie de sessão setado em `127.0.0.1`, redirect manda browser pra `localhost`, browser não envia cookie, dashboard cai pra login (loop).

5. **`middleware.ts → proxy.ts` é renomeação real do Next 16.** A função também precisa ser renomeada (`export function proxy()`). Já estava correto no código, mas vale documentar.

6. **Não testar RLS via psql + `SET request.jwt.claims`.** O `auth.uid()` do Supabase lê via PostgREST HTTP wrapper, não GUC. psql impersonation sempre retorna 0 rows independente da policy. Métodos válidos: (a) UI logada, (b) curl com Bearer JWT real, (c) `service_role` pra bypassar RLS como controle.

E o **anti-pattern do chat**: paste de código com `@` ou `.` em strings vira markdown link `[texto](url)`. Não é bug do código — é renderização. Validar com `xxd` ou `wc -l + grep -n` quando suspeitar.

### 3. Auditoria Google Ads — fixes #4 e #5 (alteram Fase 1)

Aplicar **APENAS** os 2 que afetam Fase 1. Os críticos #1, #2, #3 são pra Fase 3 (Data Manager API), ignora aqui.

#### Fix #4 — Aliases pro `xcod` (iOS 17+ Link Tracking Protection)

**Problema:** iOS 17+ stripa `xcod` query param. Soluções: aceitar aliases configuráveis no `/lt.js` que o cliente coloca via tracking template do Google Ads (`{lpurl}?lt_gci={gclid}&lt_wbr={wbraid}&lt_gbr={gbraid}`).

**Tarefas:**
- [ ] Editar `worker/src/lt.js` (ou onde estiver o script servido) pra aceitar aliases `lt_gci`, `lt_wbr`, `lt_gbr` além de `xcod`
- [ ] Worker reconstrói canonical names (`gclid`, `wbraid`, `gbraid`) server-side a partir dos aliases
- [ ] Adicionar testes em `worker/test/` cobrindo: (a) só `xcod` continua funcionando, (b) só `lt_gci` funciona, (c) ambos presentes — `xcod` ganha, (d) nenhum dos 4 — request rejeitado como antes

#### Fix #5 — Janela de 55 dias pra adjustments

**Problema:** Google Ads não aceita conversion adjustments após 55 dias do evento original. Sem essa checagem, retry infinito de uploads que vão falhar.

**Tarefas:**
- [ ] No parser de webhook (Kiwify e Hotmart, futuramente Payt), adicionar checagem: se evento é `refund`/`chargeback` E `(now - original_conversion.occurred_at) > 55 dias`, marcar `conversion_uploads.status = 'skipped_window_expired'` em vez de `pending`
- [ ] Adicionar enum value `skipped_window_expired` na coluna `status` da tabela `conversion_uploads` (migration 003 ou inline)
- [ ] Testes cobrindo: (a) refund dentro da janela vira `pending`, (b) refund fora da janela vira `skipped_window_expired`, (c) edge case exato 55 dias

### 4. Tech debts do `phase-1-status.md` (pré-merge)

Aplicar antes do merge pra não levar débito pra `main`:

- [ ] **Hottok comparison não-timing-safe** em `worker/src/routes/webhook-hotmart.ts`. Substituir comparison string direta por `timingSafeEqualHex` (já existe util? Se não, implementar em `worker/src/lib/crypto.ts`)
- [ ] **Code duplication ~92% entre `webhook-kiwify` e `webhook-hotmart`.** Extrair `worker/src/lib/webhook-base.ts` com lógica comum (HMAC verify, dedup check, parser dispatch, conversion insert, response). Refatorar os 2 routes pra usar a base. **Manter testes verdes durante refactor** (rodar `pnpm test` a cada step)
- [ ] **Volatile DEFAULT em migration 002.** Em prod, splittar em 3 statements (ALTER ADD nullable → UPDATE valores → ALTER SET NOT NULL). Documentar isso no migration file mas **não rodar em dev** — migration 002 já foi aplicada e está OK localmente
- [ ] **Vitest tests poluindo banco real.** Tests deixaram registros `tc_cors`, `match_d` no banco. Isolar com prefix `test_` e cleanup garantido (afterAll/beforeEach). Rodar `pnpm test` no fim e validar que não cria nada novo no banco dev

### 5. Validação pré-merge

```bash
# Smoke test rápido (não roda os 12 steps, só sanity check)
pnpm worker:dev &
pnpm app:dev &
# Espera 10s

# Webhook Kiwify (Step 5 do smoke test) — deve voltar 200
curl -i -X POST http://localhost:8787/webhook/kiwify/dev_kiwify_token_aaaaaaaaaaaaaaaa \
  -H "Content-Type: application/json" \
  -H "X-Kiwify-Webhook-Signature: <HMAC válido — gera com helper>" \
  -d @worker/test/fixtures/kiwify-paid.json

# Magic link (Step 10) — manualmente pelo browser em http://127.0.0.1:3000/login com dev@finaltrack.local

# RLS (Step 11) — log out, log in com user novo, vê tabela vazia em /dashboard/conversions
```

### 6. Commit + merge

```bash
# Commit estruturado (não tudo num commit só)
git add app/app/auth/callback/route.ts app/app/login/page.tsx app/lib/supabase/client.ts app/lib/supabase/server.ts app/next.config.ts
git commit -m "fix(auth): magic link end-to-end com 127.0.0.1 canônico

- callback usa NEXT_PUBLIC_SITE_URL (workaround para Next 16 normalizar 127.0.0.1 -> localhost)
- supabase server client com error explícito quando env vars faltam
- login page com try/catch e console.error
- next.config com allowedDevOrigins pra HMR cross-origin

Closes Step 10 do smoke test."

git add supabase/config.toml
git commit -m "chore(supabase): site_url + redirect_urls com wildcard

- site_url canônico em 127.0.0.1
- additional_redirect_urls com /** wildcard pra liberar /auth/callback?next=/dashboard"

git add docs/plans/phase-1-status.md
git commit -m "docs(fase-1): gotchas descobertos no smoke test

6 bugs documentados: redirect_urls silencioso, Inbucket SMTP travado,
Next 16 cross-origin, request.url normalization, proxy.ts rename,
psql RLS impersonation. Mais anti-pattern markdown vazado."

# Auditoria + tech debts em commits separados (estrutura abaixo)
git commit -m "feat(worker): aliases lt_gci/lt_wbr/lt_gbr pra iOS 17+ LTP (#4)"
git commit -m "feat(worker): janela 55d pra adjustments (#5)"
git commit -m "fix(worker): timing-safe Hottok comparison"
git commit -m "refactor(worker): extract webhook-base.ts (Kiwify+Hotmart shared)"
git commit -m "test(worker): isolate Vitest with test_ prefix + afterAll cleanup"

# Push e merge
git push origin feat/fase-1-click-capture
# Abre PR no GitHub, ou merge direto se preferir CLI:
git checkout main
git merge --no-ff feat/fase-1-click-capture -m "merge: Fase 1 - click capture + webhooks + RLS (#1)"
git push origin main
```

---

## Importante: contexto de ambiente

- **Workspace:** `C:\Users\lenzi\FinalTrack`
- **OS:** Windows + Git Bash
- **Node:** v24.15.0 via nvm-windows
- **4 terminais ativos:** T1 supabase, T2 worker, T3 app, T4 livre, T5 LP test (porta 4000)
- **psql não está no PATH.** Usar `docker exec supabase_db_FinalTrack psql -U postgres -c "..."` ou `docker exec -i supabase_db_FinalTrack psql -U postgres <<'EOF' ... EOF` para heredoc

## UUIDs canônicos (não confundir)

| Entidade | UUID |
|---|---|
| Workspace | `00000000-0000-0000-0000-000000000001` (termina em 001) |
| User dev | `00000000-0000-0000-0000-00000000000a` (termina em 00a) |

⚠️ Confundir os dois quebra tudo (FK violation). Sempre validar com `SELECT` no banco antes de confiar.

## Próximos passos pós-merge

Em branches dedicadas:
- `feat/payt-integration` — adicionar Payt como 3ª plataforma de webhook (parser, fixtures, tests). Doc oficial: https://github.com/ventuinha/payt-postback. Diferenças vs Kiwify/Hotmart documentadas no `phase-1-status.md`.
- `feat/fase-3-data-manager-api` — auditoria Google fixes #1, #2, #3 (Data Manager API migration, Enhanced Conv schema vs braids)

---

**Ao retomar:** lê esse handoff inteiro primeiro, depois `docs/plans/phase-1-status.md`, depois roda `git status` e `git diff` pra confirmar que o estado bate com o que está documentado aqui. Se algo divergir, pausa e pergunta antes de continuar.