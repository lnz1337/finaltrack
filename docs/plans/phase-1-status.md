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
| Click capture | 14-16 | em andamento |
| Webhooks Kiwify + Hotmart | 17-20 | pendente |
| Frontend (Next.js + login + dashboard) | 21-26 | pendente |
| Smoke test E2E | 27 | pendente |

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

---

## Como recuperar artefatos da conversa de planejamento

Se algum contexto ficou só na conversa, ele já foi destilado pra:

- **Spec:** `docs/specs/phase-1-click-capture.md` — 22 decisões consolidadas, fluxos e critérios de aceite
- **Plano:** `docs/plans/phase-1-click-capture.md` — 27 tarefas com código completo
- **Histórico de decisões:** `git log` (commits `cafc7e4`, `0aea8eb`, `04e5bde`)

Não há nada solto na conversa que não esteja registrado em arquivo.
