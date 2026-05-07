# Handoff: brainstorm Fase 2A — 2026-05-07

> Pausa no meio do brainstorm da Fase 2A (Connect + Read Foundation).
> Seção 1 do design (Arquitetura) aprovada; faltam seções 2-7 + escrever
> spec + writing-plans. Quando retomar, começa lendo este doc.

## Contexto

Fase 1 (click capture) + Payt + dashboard-test-filter mergeadas na main
(HEAD: `8b6c1e2`, 2026-05-06).

Leo pediu brainstorm da Fase 2 (Google Ads upload). Brainstorming skill
de superpowers aplicada. Decomposição combinada em 3 sub-projetos
sequenciais: **2A → 2C → 2B**.

**Esta sessão fechou só a 2A até a Seção 1 do design.**

## Decomposição da Fase 2 (combinada)

| | Sub-projeto | Depende de |
|---|---|---|
| 2A | Connect + Read Foundation: OAuth, lib API client, sync de campaigns/ad_groups/ads metadata, UI integrations + /dashboard/campaigns minimal | — |
| 2C | Conversion Upload: Offline Conversion Import (gclid) + Enhanced Conversions (email/phone hashed) + adjustments (refund/chargeback) | 2A (OAuth) |
| 2B | Cost Sync: cost_data daily rollup, dashboard ROAS/CPA por campaign/ad_group/ad | 2A (campaigns populadas) |

Cada sub-projeto = ciclo brainstorm → spec → plan → execute separado.

## Decisões consolidadas pra Fase 2A (10 perguntas respondidas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Escopo Fase 2 macro | (b) Upload + cost sync no mesmo ciclo, decomposto em 3 sub-projetos |
| 2 | Ordem após 2A | (ii) A → C → B (upload antes de cost sync; alimenta smart bidding primeiro) |
| 3 | Developer token status | Single-tenant ("my own account"); Leo submete formulário Basic Access durante implementação. Dev contra test customer até token aprovar (~3-5 dias). Re-submete como third-party caso vire SaaS depois. |
| 4 | OAuth handler location | (c) Híbrido — App = UI; Worker = endpoints OAuth + API calls. ENCRYPTION_KEY isolada no Worker secret. |
| 5 | Escopo metadata sync | (c) campaigns + ad_groups + ads + tratamento explícito de asset_groups (PMax/DG) |
| 6 | Trigger e cadência | (b) Manual + cron diário 03:00 UTC |
| 7 | Schema strategy asset_groups | (a) Reuse `ad_groups` + `ads` com `entity_type` field, **+ `metadata JSONB`** pra capturar specifics por formato (video_id pra YouTube, asset_type pra PMax, etc.) |
| 8 | REMOVED entities | (c) Soft delete — sync marca status='REMOVED' mas mantém row; dashboard filtra por padrão; toggle `?include_removed=1` igual pattern do `is_test` |
| 9 | UI scope | (b) Integrations page (connect/sync/disconnect) + `/dashboard/campaigns` minimal (lista flat sem cost) |
| 10 | Testing strategy | (b) Hybrid — unit tests com mock no CI + smoke manual contra Google Ads test customer antes do merge (pattern Fase 1) |

**Contexto Leo (DG/YouTube):** uso primário é Demand Gen + YouTube ads;
schema flat (a) preserva 1-1-1 view (foco do dashboard).

## Seção 1 do Design — APROVADA por Leo

```
┌─────────────────────────────────────────────────────────────┐
│  App (Next.js) — UI only                                    │
│                                                             │
│  /dashboard/integrations  →  "Conectar Google Ads" button   │
│                              (redirect pro Worker /oauth/start)
│                              status display + sync trigger  │
│                                                             │
│  /dashboard/campaigns      →  Lista flat sincronizada       │
│                              (campaigns + ad_groups + ads)  │
│                              filtro padrão: status≠REMOVED  │
│                              toggle ?include_removed=1      │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ redirect / fetch
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker — OAuth + API + Sync                     │
│                                                             │
│  GET  /oauth/google-ads/start    →  302 pro Google consent  │
│  GET  /oauth/google-ads/callback →  troca code, encrypta,   │
│                                     grava google_ads_accounts│
│                                     redirect pro /dashboard/integrations
│                                                             │
│  POST /api/google-ads/sync       →  on-demand sync          │
│                                     (chamado pelo botão UI) │
│                                                             │
│  Cron: 0 3 * * *                 →  sync diário todas       │
│                                     google_ads_accounts ativas│
│                                                             │
│  lib/google-ads/                                            │
│    ├─ oauth.ts        — OAuth code↔token flow              │
│    ├─ client.ts       — refresh access_token, signed fetch  │
│    ├─ crypto.ts       — AES-256-GCM (já existe em lib/crypto)│
│    └─ sync.ts         — pull campaigns/ad_groups/ads, upsert│
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Postgres REST (service role)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase — Postgres + RLS                                  │
│                                                             │
│  google_ads_accounts  (já existe; refresh_token encrypted)  │
│  campaigns            (já existe)                            │
│  ad_groups            (migration 004: +entity_type, +metadata)│
│  ads                  (migration 004: +entity_type, +metadata)│
│  cost_sync_log        → renomear pra google_ads_sync_log    │
│                         + ganhar `sync_type TEXT`            │
│                         (reusada pra metadata e cost sync)   │
└─────────────────────────────────────────────────────────────┘
```

**Princípios fixados:**
- App nunca toca refresh_token. Toda manipulação de token vive no Worker.
- `ENCRYPTION_KEY` fica isolada como Worker secret (Vercel não tem cópia).
- Sync diário é safety net; user controla via botão "Sincronizar agora".
- `cost_sync_log` renomeada pra `google_ads_sync_log` na migration 004,
  ganha `sync_type TEXT` ('metadata' | 'cost'), reusada pelas duas fases.

## O que falta no brainstorm (próxima sessão)

### Seções pendentes do design (apresentar uma a uma, esperar OK)

- **Seção 2 — Componentes:** detalhar cada arquivo de `worker/src/lib/google-ads/`,
  cada rota Worker, cada página/componente App. Quem chama o quê.
- **Seção 3 — Data flow:**
  - OAuth flow completo (state param, PKCE? CSRF protection, redirect URI whitelist)
  - Sync flow (query GAQL específico, paginação, upsert lógica, REMOVED detection)
- **Seção 4 — Error handling:**
  - OAuth: invalid_grant, user denial, network errors
  - Sync: rate limit, expired refresh_token, partial failure (campaigns OK / ads falhou)
  - Retry strategy (exponential backoff já mencionado em AGENTS.md sec 13)
- **Seção 5 — Testing aplicado:** quais fixtures gravar, qual checklist manual
- **Seção 6 — Migration 004:** SQL específico (ALTER TABLE ad_groups ADD entity_type, etc.)
- **Seção 7 — UI specifics:**
  - `/dashboard/integrations` markup (status display, botões, loading states)
  - `/dashboard/campaigns` markup (tabela, hierarchy, filter toggle)

### Após design aprovado

1. Escrever spec em `docs/specs/fase-2a-google-ads-connect.md`
   (path conforme convenção do repo — sem `superpowers/`, sem prefixo de data)
2. Spec self-review (placeholder scan, internal consistency, scope, ambiguity)
3. Leo revisa o spec escrito
4. Invocar `superpowers:writing-plans` pra criar plano de execução

## Estado do repositório

- **Branch ativa:** `main` (working tree clean)
- **main HEAD:** `8b6c1e2 merge: filtro is_test no dashboard de conversoes`
- **Branches preservadas:** `feat/fase-1-click-capture`, `feat/payt-integration`,
  `feat/dashboard-test-filter`
- **156 testes worker passando.** DB local com 3 conversions reais.

## Tasks abertas no TaskList desta sessão

- #15 [in_progress] Apresentar design por seções com aprovação incremental
  (seção 1 OK; seções 2-7 pendentes)
- #16 [pending] Escrever spec em docs/specs/...
- #17 [pending] Spec self-review
- #18 [pending] Aguardar review do Leo no spec
- #19 [pending] Transição: invocar writing-plans

## Próxima sessão — primeiro prompt

> "Retomar brainstorm Fase 2A. Lê
> `docs/handoffs/2026-05-07-fase-2a-brainstorm.md` e continua na Seção 2
> do design (Componentes detalhados)."

(Ou Leo ajusta o ponto de retomada.)
