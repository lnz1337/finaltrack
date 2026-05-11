# Fase 1 — Estado de Execução

> Documento vivo: atualizar conforme tasks são concluídas. Objetivo é permitir retomar a implementação do zero em outra sessão sem perder contexto.

---

## Onde paramos

**Data da pausa:** 2026-05-03
**Branch:** `feat/fase-1-click-capture` (criada a partir de `main`)
**Estado do worktree:** limpo (sem mudanças pendentes)
**Last commit na branch:** mesmo HEAD do main no momento da criação (`04e5bde docs: plano de implementacao da Fase 1`)

**Modo de execução escolhido:** Subagent-Driven Development (skill `superpowers:subagent-driven-development`).
**Cadência escolhida:** opção (c) — pausar só se reviewer rejeitar 2x ou aparecer decisão de design.

**Task atual:** **Task 0 (Verificar pré-requisitos) — BLOQUEADA**

### Razão do bloqueio

Na máquina (Windows 10 Pro, `C:\Users\lenzi\FinalTrack`) só está instalado:

- ✅ Node.js v24.15.0

Faltam (todos requeridos pela stack do spec):

- ❌ `pnpm` — `npm install -g pnpm`
- ❌ `wrangler` — `npm install -g wrangler`
- ❌ `supabase` CLI — https://github.com/supabase/cli/releases (instalador `.exe` ou `scoop install supabase`)
- ❌ `docker` — Docker Desktop for Windows (necessário pro Supabase local rodar)

---

## Pra retomar

### Passo 1 — instalar tools no PowerShell

```powershell
npm install -g pnpm
npm install -g wrangler
# supabase: baixar instalador da release mais recente em github.com/supabase/cli/releases
# docker: instalar Docker Desktop e iniciar o serviço
```

Depois confirmar:

```powershell
node --version       # v20+ (temos v24, ok)
pnpm --version       # 9.x esperado
wrangler --version   # 3.x esperado
supabase --version   # 1.x esperado
docker --version     # qualquer recente; serviço precisa estar rodando
```

### Passo 2 — abrir Claude Code na pasta e dizer:

> "Retomar implementação da Fase 1. Estamos na branch `feat/fase-1-click-capture`. Estado em `docs/plans/phase-1-status.md`. Próximo passo é Task 0 do plano `docs/plans/phase-1-click-capture.md`."

Claude deve:

1. Ler `docs/plans/phase-1-status.md` (este arquivo) pra contexto
2. Ler `docs/plans/phase-1-click-capture.md` pro plano completo
3. Ler `docs/specs/phase-1-click-capture.md` pro spec aprovado
4. Recriar o tracker de tarefas com as 28 entradas (Task 0 + Tasks 1-27)
5. Validar de novo o Passo 1 acima (todas as ferramentas disponíveis)
6. Continuar do Task 0 → Task 1 → ... usando a skill `superpowers:subagent-driven-development`

### Passo 3 — alternativas se decidir mudar de via

- **Sem Docker:** trocar Supabase local por projeto remoto (free tier em supabase.com). Plano precisa de pequeno ajuste em Task 2 (substituir `supabase start` por `supabase link` apontando pro projeto cloud) e nas envvars (URL/keys vêm do projeto remoto).
- **Sem pnpm:** trocar por npm/yarn. Plano precisa de ajuste em Task 1 (substituir `pnpm-workspace.yaml` por `workspaces` no `package.json` e usar npm).

Documente a decisão antes de implementar.

---

## Progresso por bloco

| Bloco | Tasks | Status |
|---|---|---|
| Fundação (workspace + DB + seed) | 1-4 | ✅ done (2026-05-04) |
| Worker scaffold + libs core | 5-13 | ✅ done (2026-05-04) — 52 testes passando |
| Click capture | 14-16 | ✅ done (2026-05-04) — 57 testes passando |
| Webhooks Kiwify + Hotmart | 17-20 | ✅ done (2026-05-04) — 72 testes passando |
| Frontend (Next.js + login + dashboard) | 21-26 | ✅ done (2026-05-04) — Next 16 + Tailwind v4 + shadcn |
| Smoke test E2E | 27 | 🔧 fix aplicado (2026-05-04): rota `/auth/callback`, emailRedirectTo, middleware→proxy |

Atualize esta tabela conforme completa cada bloco.

---

## Decisões em aberto durante execução

(Adicionar aqui qualquer escolha de design feita durante implementação que não estava no spec — pra ficar rastreável.)

### Bloco Fundação (Tasks 1-4) — 2026-05-04

- **Fix SQL em `migrations/001_initial.sql`** (commit `85885e6`): `UNIQUE(... COALESCE(...))` inline em `cost_data` foi convertido pra `CREATE UNIQUE INDEX` separado. Postgres não permite função em UNIQUE inline; semanticamente equivalente pro nosso uso (cost_data não é alvo de FK).
- **Migration 002 — DEFAULT volátil em `endpoint_token`**: `gen_random_bytes(24)` é volatile, então em prod com dados existentes o ALTER TABLE vai reescrever a tabela. Em dev (tabela vazia) isso não importa. Pra prod, considerar split em 3 statements (ADD nullable → UPDATE → SET NOT NULL) quando rodar contra tabela com dados.
- **Seed dev refatorado pra `scripts/setup-dev.sh`** (commit `7edc20a`): `auth.users INSERT` direto em SQL foi rejeitado por fragilidade contra upgrades futuros do Supabase. Substituído por orquestração em bash: `supabase db reset --no-seed` → `curl POST /auth/v1/admin/users` (UUID fixo) → `psql` pra inserir workspace+offers+webhook_secrets. Idempotente.
- **2 serviços Supabase parados no Windows** (`imgproxy`, `pooler`): limitação conhecida do Docker em named pipe. Não-bloqueante pra Fase 1 (não usamos image transforms nem connection pooler).
- **Code quality nits não-aplicados em `scripts/setup-dev.sh`**: error context explícito no `docker exec`, fail-on-error na verificação. Reviewer aprovou como non-blocking; deixados pra polish posterior se incomodarem.

### Bloco Worker (Tasks 5-13) — 2026-05-04

- **Vitest config tem 2 ajustes além do plano** (commit `fb7c5a0`): `compatibilityDate` e `main` no bloco miniflare. Necessários porque `@cloudflare/vitest-pool-workers@0.5.41` não auto-infere de `wrangler.toml.example`. Valores espelham o `wrangler.toml.example`.
- **Root `package.json` tem `pnpm.onlyBuiltDependencies`** (esbuild, sharp, workerd) — pnpm 10 exige allow-list explícito pra postinstall.
- **`worker/.dev.vars` autoload pelo vitest pool** (commit `15f080b`): testes de integração (supabase, matching) leem `env.SUPABASE_URL` etc. direto via `cloudflare:test`. Sem wiring extra.
- **lib/utm.ts ganhou guard** (commit `f4e0e22`): rejeita input com nome vazio após pipe inicial (`'|123'`). Plano original aceitava; reviewer flagou; user aprovou ajuste.
- **52 testes passando** ao fim do bloco (health 2 + utm 7 + cookies 6 + ua 16 + geo 3 + crypto 7 + supabase 3 + dedup 3 + matching 5).

### Bloco Click capture (Tasks 14-16) — 2026-05-04

- **`req.json<T>()` substituído por `(await req.json()) as T`** em `/track/click` por incompatibilidade de typing com a interface Request do pool. Funcionalmente idêntico.
- **Dead-code `if (...) {}`** no track-click pra documentar "aceita JSON e text/plain (sendBeacon manda como text/plain)". Plan-faithful, lá só pra registro intencional.
- **57 testes passando** (track-click 4 + lt-script 1 + 52 prior).
- **CORS implementado** (commit `b46b904`, completado por `3e1529c`): allowlist via `ALLOWED_TRACKING_ORIGINS` lida do env, `OPTIONS /track/click` com preflight 204/403, `Access-Control-Allow-Origin` ecoado em todas as respostas do POST quando origin é permitida. `http://localhost:4000` adicionado ao default em `wrangler.toml.example` e `.dev.vars.example` pra cobrir o smoke test com `http-server`.
- **sendBeacon CORS fix** (commit `3e1529c`, descoberto durante smoke): `/lt.js` mandava `new Blob([body], { type: 'application/json' })` pro `navigator.sendBeacon`, mas `application/json` NÃO é CORS-safelisted — browser silenciosamente bloqueava com `false` retorno. Fix: Blob type → `text/plain` (safelisted, sem preflight) + capturar return value e cair pra `fetch keepalive` se falhar. Worker passou a aceitar `Content-Type: text/plain` explicitamente via `req.text()` + `JSON.parse()` (substituiu o dead-code `if`).
- **Test data isolation** (commit `6bf626e`): cleanup era só `beforeEach`, então o ÚLTIMO teste de cada suite deixava lixo no banco real (ex: `tc_cors`, `match_d` apareceram no smoke). Refatorado: prefixos uniformes `test_*` (clicks) e `TEST-*` (conversions external_order_id) + `afterAll` em todas as suites pra garantir cleanup mesmo se teste quebra.
- **77 testes passando** (track-click 5 + lt-script 1 + 71 prior).

### Bloco Webhooks (Tasks 17-20) — 2026-05-04

- **`.dev.vars` precisa de `ENV="development"`**: vitest-pool-workers não injeta `[vars]` do wrangler.toml.example pro runtime via `SELF.fetch`, só os secrets do `.dev.vars`. Sem `ENV` setado, `resolveWebhookSecret` cai no fluxo de prod (decrypt placeholder ciphertext) e webhook 401-a tudo. Adicionado em `.dev.vars` E `.dev.vars.example` (commits `9bccee3` + `0608a7a`).
- **`beforeEach` no webhook-kiwify foi estendido**: cleanup original do plano deixava `click_other_id` (test 3) sobrando entre runs, causando 409 unique-constraint na 2ª execução. Adicionado delete extra `like.click_other%`.
- **Duplicação ~92% entre `webhook-kiwify.ts` e `webhook-hotmart.ts`**: aceito pra v1 (auth diferentes — HMAC vs Hottok). Refatorar em `processConversion()` helper se aparecer terceira plataforma.
- **Hottok comparison não é timing-safe** (`!==` direto). Static shared secret tem risco menor de timing attack que HMAC, mas defensivamente vale upgrade pra `timingSafeEqualHex` em v2.
- **72 testes passando** (webhook-hotmart 3 + webhook-kiwify 5 + hotmart parser 3 + kiwify parser 4 + 57 prior).

### Smoke test login fix — 2026-05-04

- **`app/app/auth/callback/route.ts` criado**: Route Handler GET que recebe `?code=`, chama `supabase.auth.exchangeCodeForSession(code)` e redireciona para `next` (default `/dashboard`). Sem esse handler, o PKCE code-verifier era setado mas o access token nunca era trocado.
- **`emailRedirectTo` corrigido em `app/app/login/page.tsx`**: apontava para `${origin}/dashboard` (sem handler para PKCE), corrigido para `${origin}/auth/callback?next=/dashboard`.
- **`app/middleware.ts` renomeado para `app/proxy.ts`**: Next.js 16 deprecou a convencao `middleware.ts` em favor de `proxy.ts`. Export renomeado de `middleware` para `proxy`. Assinatura identica (`request: NextRequest`), mesmo `config.matcher`. Sem mudancas no helper interno `app/lib/supabase/middleware.ts` (nome interno, nao convencao Next).

### Bloco Frontend (Tasks 21-26) — 2026-05-04

- **Next.js 16.2.4 instalado** (não 15 como o plano previa) — latest stable. App Router, Tailwind v4 (CSS-first config), shadcn (estilo base-nova), Turbopack ativo apesar do `--no-turbopack` (Next 16 default). Supabase SSR `^0.10.2`. User pré-aprovou prosseguir com versões atuais.
- **`(dashboard)` route group** — auth guard centralizado no layout, redirect pra `/login` se sem session.
- **Tipos TS gerados** com `supabase gen types typescript --local` — 923 linhas, todas as 13 tabelas + views.
- **Dependências instaladas no app workspace**: `@supabase/supabase-js`, `@supabase/ssr`, shadcn (button, input, table, card, label).
- **`app/.env.local.example` commitado**, `app/.env.local` gitignored com anon key local.
- **Cookies do Supabase SSR** funcionam com `await cookies()` em Next 16 (já era async desde Next 15).
- Build passa em `pnpm --filter ./app build`. Sem testes automatizados (frontend é coberto pelo smoke).

### Gotchas Fase 1 descobertos no smoke test — 2026-05-04

Bugs encadeados resolvidos durante execução manual do E2E (Steps 10-12). Todos documentados aqui pra não cair de novo.

1. **`supabase/config.toml` — `additional_redirect_urls` rejeita silenciosamente.** Default era `https://127.0.0.1:3000` (https sem path). Fix: `["http://127.0.0.1:3000/**", "http://localhost:3000/**"]`. Sintoma: magic link redirecionava pra raiz em vez do callback.

2. **Inbucket SMTP trava mesmo com healthcheck verde.** Healthcheck só testa porta HTTP (8025), não SMTP (2500). Fix: `docker restart supabase_inbucket_FinalTrack`. Sintoma: GoTrue retorna 504 timeout em `/auth/v1/otp` após criar o user no Postgres.

3. **Next 16 bloqueia HMR cross-origin entre `127.0.0.1` e `localhost`.** Fix: `allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.0.8']` em `next.config.ts`. Sintoma: WebSocket HMR falha com `ERR_INVALID_HTTP_RESPONSE`, submit do form não dispara nada visível.

4. **`new URL(request.url).origin` em route handler do Next 16 normaliza `127.0.0.1` → `localhost`.** Fix: usar `process.env.NEXT_PUBLIC_SITE_URL` como origin canônico no callback. Sintoma: cookie de sessão setado em `127.0.0.1`, redirect manda browser pra `localhost`, browser não envia cookie, dashboard cai pra login (loop).

5. **`middleware.ts → proxy.ts` é renomeação real do Next 16.** A função também precisa ser renomeada (`export function proxy()`). Já estava correto no código, mas vale documentar.

6. **Não testar RLS via psql + `SET request.jwt.claims`.** O `auth.uid()` do Supabase lê via PostgREST HTTP wrapper, não GUC. psql impersonation sempre retorna 0 rows independente da policy. Métodos válidos: (a) UI logada, (b) curl com Bearer JWT real, (c) `service_role` pra bypassar RLS como controle.

**Anti-pattern do chat (não é bug do código):** paste de código com `@` ou `.` em strings pode virar markdown link `[texto](url)` na renderização. Validar com `xxd` ou `wc -l + grep -n` quando suspeitar.

### Bloco Payt integration — 2026-05-05

- Payt mergeada na main como 3ª plataforma de webhook (commit `2f89a77`)
- N=3 valida retroativamente skip do Passo D — webhook-base helpers reusados sem refactor
- 156 testes (126 prior + 30 Payt: 20 parser + 10 route) + 18 fixtures
- Smoke runtime 4 cenários aprovado via curl + psql
- Schema preparado pra filtro `is_test=false` no dashboard (branch `feat/dashboard-test-filter`)
- Auth estratégia nova: `integration_key` no body (timing-safe), parse JSON antes do auth check — diferente de Kiwify (HMAC body-first) e Hotmart (Hottok header-first)
- Click ID com fallback chain de 4 níveis pra acomodar evolução do schema Payt: `lt_gci` 2025 → 2020 → `link.query_params` → `link.sources` → `utm_*`
- IgnoredEventError dedicada pra eventos logística/subscription (return 200 sem insert)

### Tech debts conhecidos

- **`tests/dedup.test.ts` e demais usando `cloudflare:test` runner mostram erros TS** de tuple length 0 e RequestInit conversion. Origem: módulo virtual `cloudflare:test` não exporta tipos no `@cloudflare/vitest-pool-workers` atual. Sem impacto em runtime — testes passam. Workaround temporário ou aguardar fix upstream.
- **Insert de `conversions` não retorna UUID atualmente.** O wrapper `worker/src/lib/supabase.ts` hardcoda `Prefer: return=minimal`. Convenção do wrapper, não limitação do PostgREST (que suporta `return=representation`). Fase 3 vai precisar do id retornado pra criar `conversion_uploads` — investigar uso de `.select()` pós-insert ou expor opção `returnRepresentation` no wrapper quando essa fase começar.
- **Smoke tests de `webhook-kiwify`/`webhook-hotmart` cobrem refund/chargeback paths sem inserir 'paid' prévio.** `checkAdjustmentWindow` exit-early (`originalConversion=null`) preserva green sem testar o warn path explicitamente. Ao refatorar `webhook-base.ts` (Seção 4 do handoff), considerar fixtures que incluem 'paid' anterior pra exercitar checagem de janela end-to-end.
- **Migration 002 usa volatile DEFAULT em `ALTER ADD COLUMN`.** Em prod com volume, splittar em 3 statements (ALTER ADD nullable → UPDATE backfill → ALTER SET NOT NULL). Documentado no header do arquivo `supabase/migrations/20260503000002_webhook_endpoint_token.sql`.
- **Flakiness transient no vitest pool de Cloudflare Workers.** Observado pós-commit `6da4c90` (Payt is_test propagation): primeira execução de `pnpm test` falhou em 1 teste não-identificado, re-run imediato veio limpo. Provável race no test pool de `@cloudflare/vitest-pool-workers`. Sintoma adjacente já documentado: erros TS de tuple length 0 no runner `cloudflare:test`. Provável mesma origem upstream. Não-bloqueante hoje (re-run resolve), mas vale watch upstream pra fix oficial.

#### Phase 2A — diferidos do Checkpoint 1 (2026-05-11)

Findings do code-quality review da Phase 1 da Fase 2A que Leo aprovou como tech debt em vez de fix imediato. Bloqueantes resolvidos via patches P1-P4 (commits `84cf001`, `180916f`, `fa5f2cd`, `513de13`).

- **D1. Comment "cost_sync_log pre-condition: 0 rows" em migration 004.** A constraint `status CHECK (status IN ('running','success','partial','failed'))` falharia em ALTER se existissem rows com status fora do set. Hoje tabela vazia = OK. Comment de 1 linha; adicionar se mexer no arquivo por outro motivo.
- **D2. Cobertura adicional `ad_groups_marked` + `ads_marked` da RPC `mark_removed_for_account`.** Cenários da Task 3 (mark-removed.test.ts) só assertam `campaigns_marked`. Cascade ad_groups/ads não tem cobertura integration direta — confiamos no smoke Phase 8 contra volume real. Considerar fixtures dedicados quando Tasks 6+ trouxerem dados de ad_groups e ads.
- **D3. Remover `SbExtended` interface redundante em `mark-removed.test.ts`.** Foi adicionada antes de `rpc()` entrar no `SupabaseClient` real. Hoje o `ReturnType<typeof createSupabaseClient>` já cobre `rpc`. Cleanup cosmético.
- **D4. Comment "uses JS clock; OK for local + prod (drift < 1s irrelevant for 10min TTL)" em `oauth-pending.test.ts`.** Test #3 usa `new Date().toISOString()` do JS pra cleanup DELETE filter — assume sync com clock do Postgres. Local Supabase = mesma máquina, sem drift. Comment de 1 linha.
- **D5. Assertion bidirecional em `oauth-pending.test.ts` Test #2 expires_at.** `Math.abs(expires_at - target) < 5000` aceita drift nos dois lados (ex.: 4s antes do esperado seria sinal de bug e o teste aprovaria). Trocar por `expect(expires_at).toBeGreaterThanOrEqual(target); expect(expires_at - target).toBeLessThan(5000);`. Cosmético.

---

## Como recuperar artefatos da conversa de planejamento

Se algum contexto ficou só na conversa, ele já foi destilado pra:

- **Spec:** `docs/specs/phase-1-click-capture.md` — 22 decisões consolidadas, fluxos e critérios de aceite
- **Plano:** `docs/plans/phase-1-click-capture.md` — 27 tarefas com código completo
- **Histórico de decisões:** `git log` (commits `cafc7e4`, `0aea8eb`, `04e5bde`)

Não há nada solto na conversa que não esteja registrado em arquivo.
