# LeoTracker — AGENTS.md (v2 · Google Ads Only)

> **Idioma:** sempre responda em PT-BR.
> **Stack alvo:** $0/mês até passar dos free tiers.
> **Escopo:** Google Ads exclusivo (Search, Demand Gen, YouTube, PMax, Display).

---

## 1. Visão Geral

LeoTracker é um ad tracker próprio que mistura o melhor da **UTMify** (UX simples pra infoprodutor BR/LATAM, UTM pipe `Name|ID`, integração nativa com checkouts) com o melhor do **RedTrack** (S2S clickid, server-side conversion upload, multi-touch attribution, automação de cost sync).

**Diferencial vs concorrentes:**

- **Foco cirúrgico em Google Ads** — não tenta ser tudo pra todo mundo
- **Suporta wbraid/gbraid** (iOS app, view-through) — UTMify não trata bem
- **Server-side Enhanced Conversions** — manda conversão de volta pro Google com email/phone hasheado, melhora o algoritmo do Google Ads
- **YouTube VSL events nativos** — correlaciona play/3s/25%/50%/75%/pitch/CTA com gclid, vista única no mercado BR
- **1-1-1 friendly** — dashboard tem visão de creative isolado pra rodar SLO da forma certa

---

## 2. Arquitetura

```
[Google Ads: Search/DG/YT/PMax/Display]
    │  URL final com gclid + UTMs
    ▼
[Landing Page] ←─── /lt.js (servido pelo CF Worker)
    │  Captura: gclid/wbraid/gbraid + UTMs → first-party cookie (visitor_id, click_id) → propaga pra checkout via query string
    ▼
[Checkout: Kiwify | Hotmart | BuyGoods | ClickBank | Cartpanda | Stripe | Pepper | DigistoreX]
    │  Webhook (POST → CF Worker /webhook/:platform)
    ▼
[CF Worker: parse + correlaciona com clicks via click_id propagado]
    │
    ├─→ Supabase Postgres (insert conversion)
    │
    └─→ Google Ads API (Offline Conversion Import + Enhanced Conversions)
           ↑
[CF Cron Trigger horário] ──► sync de custo (Google Ads API → cost_data)
[Dashboard load on-demand]    debounce de 3min, evita rate limit

[Vercel · Next.js Dashboard] ─→ Supabase REST (com RLS) + CF Worker API
```

**Por que essa stack:**

| Componente | Free Tier | Por quê |
|---|---|---|
| Cloudflare Workers | 100K req/dia | Edge global, zero cold start, KV grátis |
| Supabase | 500MB Postgres + Auth | RLS nativo, REST API sem SDK |
| Vercel Hobby | 100GB bandwidth | Next.js otimizado, CI/CD nativo |
| Upstash Redis | 10K cmds/dia | Cache de cost data + dedup de webhooks |
| Cloudflare Cron | Ilimitado em Workers free | Backup do on-demand sync |

---

## 3. Modelo de Atribuição

**Hierarquia de identificação (do mais forte pro mais fraco):**

1. `gclid` (web — Search/Display/YouTube no browser, PMax web)
2. `wbraid` (iOS 14.5+ web→app)
3. `gbraid` (iOS app conversions)
4. `click_id` interno (nosso, se gclid/wbraid/gbraid não vieram — fallback raro mas existe)
5. UTMs (utm_source, utm_medium, utm_campaign, utm_content, utm_term)

**Estratégia de cookie first-party:**

- `_lt_visitor` — UUID v4, 540 dias, identifica o navegador (UTMify-like)
- `_lt_click` — última `click_id` capturada, 90 dias, propagada pro checkout via query string
- `_lt_first_click` — primeira `click_id` da sessão (multi-touch first-touch)

**Quando o checkout não suporta query string passthrough:**

Fallback por **email + IP + UA + janela de 24h** (RedTrack chama isso de "soft match"). Logado em `conversions.match_method` pra debug.

**UTM Pipe Format (UTMify-compatible):**

```
utm_campaign=NomeCampanha|123456789
utm_content=NomeAdSet|987654321
utm_term=NomeAd|456789123
```

O parser quebra no `|` e popula `campaign_name_parsed`, `campaign_id_parsed`, etc. Mantém o valor cru também pro caso de o cliente não usar o formato pipe.

---

## 4. Schema do Banco

Ver `migrations/001_initial.sql`. Resumo das 13 tabelas:

| # | Tabela | Função |
|---|---|---|
| 1 | `workspaces` | Multi-tenant (cada projeto = 1 workspace) |
| 2 | `google_ads_accounts` | OAuth tokens, customer_id, manager_id (MCC) |
| 3 | `campaigns` | Sync da Google Ads API |
| 4 | `ad_groups` | Sync da Google Ads API (asset groups pra DG/PMax) |
| 5 | `ads` | Creative-level, com preview_url |
| 6 | `offers` | Produtos/ofertas (Té Drenador, Cero Impotencia, etc.) |
| 7 | `clicks` | Hit do `/lt.js` — gclid/wbraid/gbraid + UTMs + visitor_id |
| 8 | `video_events` | Play/3s/25%/50%/75%/pitch/CTA tied to click_id |
| 9 | `conversions` | Webhook → conversão (pix/boleto/paid/refund/chargeback) |
| 10 | `conversion_uploads` | Status do envio pro Google (Enhanced Conv / Offline Conv Import) |
| 11 | `cost_data` | Daily rollup por campaign/ad_group/ad |
| 12 | `cost_sync_log` | Auditoria dos syncs (on-demand vs cron) |
| 13 | `webhook_secrets` | HMAC secrets das plataformas de checkout (encrypted) |

RLS habilitado em todas. Helper functions SQL pra rollups por período.

---

## 5. Cloudflare Worker — Endpoints

```
GET  /lt.js                    → Script de tracking servido (cacheado 1h)
POST /track/click              → Ingest de click (chamado pelo /lt.js)
POST /track/event              → VSL events (play, 3s, 25%, 50%, 75%, pitch, CTA)
POST /webhook/kiwify           → Webhook Kiwify (HMAC validation)
POST /webhook/hotmart          → Webhook Hotmart (Hottok validation)
POST /webhook/buygoods         → Webhook BuyGoods
POST /webhook/clickbank        → Webhook ClickBank (INS notification)
POST /webhook/cartpanda        → Webhook Cartpanda
POST /webhook/stripe           → Webhook Stripe (signing secret)
POST /webhook/pepper           → Webhook Pepper
POST /webhook/digistorex       → Webhook DigistoreX
GET  /api/cost/sync            → On-demand sync (debounce 3min via Upstash)
POST /api/conversion/upload    → Trigger manual de Enhanced Conv upload
GET  /api/health               → Health check
```

**Observações importantes:**

- Worker single-file `index.js`, ~900 linhas, **zero dependencies** (usa `fetch` nativo pra Supabase REST e Google Ads API)
- Toda chamada Supabase usa service_role key (env var) — nunca expor no `/lt.js`
- HMAC validation em todo webhook (cada plataforma tem o seu — lista em `webhook_secrets`)
- Idempotência via `external_order_id` UNIQUE constraint
- Cron Trigger: `0 * * * *` (de hora em hora) chama `/api/cost/sync` como backup do on-demand

---

## 6. Frontend (Next.js · Vercel Hobby)

**Design system:** shadcn/ui + Tailwind. Tema dark-first (gosto pessoal do Leo, alinhado com NexStage). Tipografia Inter.

### 6.1 Páginas

| Rota | Função |
|---|---|
| `/` | Landing pública (caso queira virar SaaS depois) |
| `/login` | Magic link via Supabase Auth |
| `/dashboard` | Visão geral: spend, revenue, ROAS, profit, conv count (range selector) |
| `/dashboard/campaigns` | Tabela de campaigns com drill-down |
| `/dashboard/campaigns/[id]` | Drill: ad groups → ads, com 1-1-1 view |
| `/dashboard/ads` | **View flat de creatives** (chave pro 1-1-1) — ROAS por ad isolado, sem agrupamento |
| `/dashboard/conversions` | Stream de conversões em tempo real (Supabase Realtime) |
| `/dashboard/funnel/[campaign_id]` | Funil VSL → conversão (play → 25% → 50% → 75% → pitch → CTA → checkout → paid) |
| `/dashboard/offers` | CRUD de offers + checkout integrations |
| `/dashboard/integrations` | Conectar Google Ads (OAuth), gerar webhook URLs |
| `/dashboard/settings` | Workspace settings, members, API keys |

### 6.2 Componentes-chave

- **`<MetricCard>`** — spend / revenue / ROAS / profit / conv count com sparkline
- **`<DateRangePicker>`** — atalhos: Hoje, Ontem, 7d, 14d, 30d, MTD, Custom
- **`<CreativeCard>`** — preview do ad + métricas (impressions, CPC, CTR, CPA, ROAS) — base do 1-1-1
- **`<SaturationIndicator>`** — alerta se CPC subiu >30% nos últimos 3 dias com volume estável
- **`<FunnelChart>`** — visual de drop-off VSL com taxas de conversão entre etapas
- **`<ConversionStream>`** — feed live (Supabase Realtime channel)

### 6.3 Performance

- Server Components onde der (drill-down de campaigns, listagem de ads)
- Client Components só pra DateRangePicker, ConversionStream, gráficos (Recharts)
- Cache de cost_data em Upstash Redis (TTL 5min) — evita martelar Supabase em refresh

---

## 7. Integrações de Checkout

**8 plataformas suportadas:**

| Plataforma | Validação | Eventos |
|---|---|---|
| Kiwify | HMAC SHA256 | order_approved, order_refunded, pix_created, billet_created, abandoned_cart |
| Hotmart | Hottok header | PURCHASE_APPROVED, PURCHASE_REFUNDED, PURCHASE_CHARGEBACK, PURCHASE_BILLET_PRINTED |
| BuyGoods | shared_secret query | sale, refund, chargeback, rebill |
| ClickBank | INS Secret Key | SALE, RFND, CHBK, BLAR, RBLT |
| Cartpanda | webhook secret | order.paid, order.refunded |
| Stripe | signing secret | checkout.session.completed, charge.refunded, charge.dispute.created |
| Pepper | HMAC | sale, refund |
| DigistoreX | API signature | on_payment, on_refund |

Cada parser fica em `worker/parsers/[platform].js` (pode ser inline mas separado por seção/comentário pra facilitar leitura).

---

## 8. Google Ads API Integration

**Auth flow:**

1. User clica "Conectar Google Ads" em `/dashboard/integrations`
2. OAuth 2.0 flow (developer token + client_id/secret + manager account)
3. Refresh token salvo encrypted (AES-256-GCM, key em CF Worker secret)
4. A cada chamada à API, gera access_token novo via refresh

**Endpoints da Google Ads API que usamos:**

- `GoogleAdsService.search` — pull de campaigns, ad_groups, ads (sync diário)
- `GoogleAdsService.search` com `metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.view_through_conversions` — cost sync
- `ConversionUploadService.UploadClickConversions` — Offline Conversion Import (com gclid)
- `ConversionUploadService.UploadConversionAdjustments` — ajustes de conversão (refund/chargeback)

**Rate limiting:**

- Operações por dia limitadas no Standard Access (15K ops/day basic dev token)
- Solicitar Basic Access do dev token logo na fase 1 (formulário Google, ~3-5 dias)
- Upstash Redis dedup pra evitar upload duplicado de conversion (key: `conv_upload:{conversion_id}`, TTL 7 dias)

---

## 9. Roadmap Fases

### Fase 1 — Click Capture & Webhook Correlation (semana 1-2)
- [ ] Cloudflare Worker `/lt.js` + `/track/click`
- [ ] First-party cookie strategy
- [ ] Schema básico (workspaces, clicks, conversions)
- [ ] Webhook parsers Kiwify + Hotmart (cobre 80% do caso BR)
- [ ] Login + dashboard mínimo (lista de conversões)

### Fase 2 — Google Ads Sync (semana 3)
**Fase 2A — OAuth + Metadata Sync: ENTREGUE (smoke parcial · 2026-05-12).** Sync real (`googleAdsSearch`) bloqueado por `DEVELOPER_TOKEN_NOT_APPROVED` — Basic Access submetido ao Google 2026-05-12. PR em DRAFT até smoke 9/9. Spec: `docs/specs/fase-2a-google-ads-connect.md` · Plan: `docs/plans/fase-2a-google-ads-connect.md` · Runbook: `docs/runbooks/fase-2a-smoke.md`.
- [x] OAuth flow Google Ads (start → consent → callback; single + multi-customer com `/integrations/select`)
- [x] Sync de campaigns/ad_groups/ads (orchestrator `syncAccount`; REMOVED detection via RPC `mark_removed_for_account`) — 258 testes verde; smoke runtime aguarda token
- [x] Cron diário backup (`scheduled()` 0 3 * * *) + cleanup de `oauth_pending_selections` expirados
- [ ] Cost sync on-demand (Fase 2B)
- [ ] Dashboard com ROAS/spend/revenue por campaign (depende de cost sync)

**Endpoints Worker da Fase 2A** (todos `INT` = `Authorization: Bearer ${WORKER_INTERNAL_TOKEN}` + `X-User-JWT`, exceto onde notado — ver `worker/src/lib/internal-auth.ts` e spec §8.1):
- `GET  /oauth/google-ads/start?workspace_id=` — `PUB` (sessão Supabase): 302 → Google consent + cookie `lt_oauth_state` (HMAC, CSRF)
- `GET  /oauth/google-ads/callback?code=&state=` — `PUB` (state cookie): 302 → App `?status=connected` (1 customer) ou `/integrations/select?session=` (2+)
- `GET  /oauth/google-ads/session/:uuid/preview` — `INT`: `{session_id, customer_ids[], expires_at}` (404 mismatch, 410 expirada)
- `POST /oauth/google-ads/finalize` — `INT`: `{session_uuid, customer_ids[]}` → `{accounts_created}`
- `POST /api/google-ads/sync` — `INT`: `{google_ads_account_id}` → `{log_id, status, started_at}` (409 sync_in_progress)
- `GET  /api/google-ads/sync-status?account_id=` — `INT`: status do último sync (UI faz polling adaptativo, decisão 5.7.2)
- `POST /api/google-ads/disconnect` — `INT`: `{google_ads_account_id}` → `{is_active:false}` (soft delete; histórico preservado)
- `scheduled()` cron `0 3 * * *` — `CRON`: itera `google_ads_accounts WHERE is_active=true` → `syncAccount(...,'cron')`; depois `DELETE FROM oauth_pending_selections WHERE expires_at < NOW()`

App proxies em `app/app/api/google-ads/*/route.ts` (injetam `WORKER_INTERNAL_TOKEN` server-side; nunca chega ao browser).

### Fase 3 — Enhanced Conversions (semana 4)
- [ ] SHA256 hashing de email/phone
- [ ] Upload server-side via Offline Conversion Import
- [ ] Conversion adjustments (refund/chargeback → ajusta no Google)
- [ ] UI de status de upload em `/dashboard/conversions`

### Fase 4 — Multi-platform Webhooks (semana 5)
- [ ] BuyGoods, ClickBank, Cartpanda, Stripe, Pepper, DigistoreX

### Fase 5 — VSL Events & View-through (semana 6)
- [ ] `/track/event` endpoint pra VSL events do VTurb
- [ ] Funnel chart no dashboard
- [ ] Reconciliação de view-through conversions (Google reporta, a gente correlaciona)

### Fase 6 — 1-1-1 & Saturation (semana 7)
- [ ] View flat de creatives
- [ ] Saturation indicator algorithm
- [ ] Alertas (email/Telegram) configuráveis

### Fase 7 — Polish (semana 8)
- [ ] Multi-workspace, members, billing (caso vire SaaS)
- [ ] Export CSV / Sheets sync
- [ ] Mobile-responsive audit

---

## 10. Decisões Tomadas (ADRs lite)

| # | Decisão | Por quê |
|---|---|---|
| 001 | Google Ads only, sem Meta | Foco; Leo está expandindo Demand Gen/YouTube; Meta tem UTMify |
| 002 | Sem deixar Meta-ready no schema | Simplicidade > optionality; refactor caso volte é trivial |
| 003 | Cloudflare Workers (não Vercel Functions) | Edge global + 100K/dia free vs 100K/mês do Vercel |
| 004 | Supabase REST direto, sem SDK | Worker zero-deps, deploy mais rápido, menor cold start |
| 005 | On-demand cost sync + cron backup | GitHub Actions estourava 2000min; on-demand é grátis |
| 006 | shadcn/ui + Tailwind | Consistência com NexStage; copy-paste de componentes |
| 007 | Server Components onde der | Performance + menor bundle |
| 008 | UTM pipe format `Name|ID` | Compatibilidade UTMify, facilita migração |
| 009 | (Fase 2A) Auth App→Worker: `WORKER_INTERNAL_TOKEN` (timing-safe) é primary auth; `X-User-JWT` só decodado, não verificado | Supabase moderno assina access_token com ES256/JWKS, não HS256+shared-secret. JWT verify aqui seria defense-in-depth. Tech debt pre-prod: migrar pra JWKS verify (lib `jose`). Ver `internal-auth.ts` + spec §8.1 |
| 010 | (Fase 2A) Google Ads API v23, versão pinada em `worker/src/lib/google-ads/constants.ts` | v17 foi sunsetted (404). Google deprecia ~3 versões/ano; revisar a cada ~6 meses |
| 011 | (Fase 2A) Confirmação destrutiva = shadcn `AlertDialog`, nunca `confirm()`/`alert()` nativo | Consistência com NexStage; UX de ações irreversíveis (disconnect) |

---

## 11. Como Rodar Local

```bash
# Pré-requisitos: Node 20+, pnpm, Wrangler CLI, Supabase CLI

# 1. Clone & install
git clone <repo>
cd leotracker
pnpm install

# 2. Supabase local
supabase start
supabase db reset  # roda migrations/001_initial.sql

# 3. Worker dev
cd worker
cp wrangler.toml.example wrangler.toml  # configurar secrets
pnpm dev  # localhost:8787

# 4. Frontend dev
cd ../app
cp .env.local.example .env.local
pnpm dev  # localhost:3000
```

**Secrets necessários (CF Worker):**

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_ADS_DEVELOPER_TOKEN
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
ENCRYPTION_KEY              # AES-256-GCM key (32 bytes hex)
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
WEBHOOK_BASE_URL            # ex: https://track.seudominio.com
```

---

## 12. Deploy

```bash
# Worker
cd worker && wrangler deploy

# Frontend (Vercel)
cd app && vercel --prod

# DNS: aponte track.seudominio.com → CF Worker route
# DNS: aponte app.seudominio.com → Vercel
```

---

## 13. Observações Finais pro Claude Code

- **Sempre PT-BR nos comentários e UI**
- **Nunca commitar secrets** (.env, wrangler.toml com tokens)
- **Webhook parser sempre valida HMAC antes de processar** — sem exceção
- **Idempotência por `external_order_id`** — conversão duplicada não pode entrar
- **Conversion upload tem retry com backoff** (3 tentativas, exponencial 1s/4s/16s)
- **Cookie samesite=Lax, secure=true em prod**
- **Não usar `localStorage` no `/lt.js`** — só cookie (alguns browsers bloqueiam LS em iframes)
- **Google Ads API tem quota** — cache agressivo de campaigns/ad_groups (24h)
- **Phase 1 é prioridade absoluta** — sem ela, nada mais funciona

> Pergunte antes de mudar arquitetura. Pequenos refactors de código tudo bem, mas mudança de stack/schema requer aprovação.
