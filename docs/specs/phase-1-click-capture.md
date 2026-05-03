# Fase 1 — Click Capture + Webhook Correlation (Kiwify + Hotmart)

> **Status:** spec aprovada (decisões 1-21 consolidadas em 2026-05-03)
> **Escopo:** AGENTS.md §9 Fase 1
> **Próximo passo:** plano de implementação detalhado (writing-plans)

---

## 1. Objetivo

Entregar a fundação do LeoTracker: capturar cliques vindos de Google Ads, propagá-los até o checkout via cookie + query string, receber webhooks de Kiwify e Hotmart, correlacionar a conversão ao clique original, e exibir tudo num dashboard mínimo autenticado.

Sem isso, nenhuma fase posterior funciona. O critério de sucesso é: clicar num anúncio com `gclid`, finalizar uma compra de teste no Kiwify ou Hotmart, e ver a conversão na tela `/dashboard/conversions` com `match_method = 'click_id'`.

---

## 2. Componentes de alto nível

```
[Browser]
  ├─ /lt.js (CF Worker, cache 1h)
  │    captura gclid/wbraid/gbraid + UTMs
  │    grava cookies _lt_visitor / _lt_click / _lt_first_click
  │    POST /track/click com payload completo
  │    reescreve links de checkout adicionando ?xcod=<click_id>
  │
[CF Worker]
  ├─ POST /track/click → drop bots → insert em clicks
  ├─ POST /webhook/kiwify/:endpoint_token → valida HMAC → parse → match → insert em conversions
  └─ POST /webhook/hotmart/:endpoint_token → valida Hottok → parse → match → insert em conversions
       (matching: click_id direto via xcod; gclid_in_payload (90d) como fallback)

[Supabase Postgres]
  workspaces, webhook_secrets (+ endpoint_token), clicks, conversions, offers

[Next.js Dashboard]
  /login (magic link) → (dashboard guard) → /dashboard/conversions (tabela SSR)
```

---

## 3. Estrutura de pastas

```
FinalTrack/
├── AGENTS.md
├── README.md
├── package.json                 # raiz com scripts orquestradores
├── pnpm-workspace.yaml
├── .gitignore
├── migrations/
│   ├── 001_initial.sql
│   └── 002_webhook_endpoint_token.sql   # adiciona coluna endpoint_token (decisão 6)
│
├── worker/
│   ├── wrangler.toml.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                 # router (switch por path)
│   │   ├── routes/
│   │   │   ├── lt-script.ts
│   │   │   ├── track-click.ts
│   │   │   ├── webhook-kiwify.ts
│   │   │   ├── webhook-hotmart.ts
│   │   │   └── health.ts
│   │   ├── parsers/
│   │   │   ├── kiwify.ts
│   │   │   └── hotmart.ts
│   │   ├── lib/
│   │   │   ├── supabase.ts          # fetch wrapper REST + service_role
│   │   │   ├── crypto.ts            # HMAC SHA256, AES-256-GCM, SHA256 hash
│   │   │   ├── cookies.ts
│   │   │   ├── utm.ts               # split Name|ID no último pipe
│   │   │   ├── ua.ts                # regex device/os/browser + bot detection
│   │   │   ├── geo.ts               # headers cf-*
│   │   │   ├── dedup.ts             # Upstash REST
│   │   │   └── matching.ts          # click_id direto > gclid_in_payload (90d)
│   │   ├── tracker/
│   │   │   └── lt.client.ts         # bundlado e servido em /lt.js
│   │   └── types.ts
│   └── tests/
│       ├── kiwify.test.ts
│       ├── hotmart.test.ts
│       ├── track-click.test.ts
│       ├── matching.test.ts
│       └── fixtures/
│           ├── kiwify-order-approved.json
│           └── hotmart-purchase-approved.json
│
└── app/
    ├── package.json
    ├── next.config.ts
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── components.json              # shadcn config
    ├── .env.local.example
    ├── middleware.ts
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                 # landing placeholder
    │   ├── login/page.tsx
    │   └── (dashboard)/
    │       ├── layout.tsx           # auth guard server-side
    │       ├── dashboard/page.tsx   # placeholder mínimo
    │       └── dashboard/conversions/page.tsx
    ├── components/
    │   ├── ui/                      # shadcn (button, table, card, input)
    │   └── conversions-table.tsx
    └── lib/
        ├── supabase/
        │   ├── client.ts
        │   ├── server.ts
        │   └── middleware.ts
        └── types/
            └── database.ts          # gerado via supabase gen types
```

---

## 4. Decisões técnicas (consolidadas)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Estrutura do repo | **pnpm workspaces** (`worker/` e `app/` no mesmo monorepo, raiz com scripts orquestradores) |
| 2 | Tipagem do schema no app | `supabase gen types typescript`, output versionado em `app/lib/types/database.ts` |
| 3 | Linguagem do worker | **TypeScript**, bundlado pelo Wrangler (esbuild interno). Mantém zero runtime deps; ganha autocomplete |
| 4 | Organização do worker | **Multi-file no source**, single bundle no deploy (Wrangler resolve) |
| 5 | Como o `/lt.js` recebe `workspace_id` | **`<script src="https://track.x.com/lt.js" data-workspace="WS_ID" defer></script>`** + init lê `data-workspace`. Mantém o script cacheável globalmente |
| 6 | Como o webhook identifica o workspace | **Path com `endpoint_token` aleatório**: `POST /webhook/kiwify/:endpoint_token`. Requer **migration 002** adicionando `webhook_secrets.endpoint_token TEXT UNIQUE NOT NULL` |
| 7 | Nome do query param de propagação do click | **`xcod`** (compatibilidade UTMify) |
| 8 | Janela de soft-match por email | **Deferido — não entra na Fase 1.** Será adicionado em fase posterior via endpoint `/track/identify` (captura email no checkout antes do webhook) |
| 9 | Parser de UA | **Regex próprio** leve (desktop/mobile/tablet × Chrome/Safari/Firefox/Edge/Other). Sem dependência |
| 10 | GeoIP | **Headers Cloudflare**: `cf-ipcountry` (sempre), `cf-region`, `cf-ipcity` (best-effort, podem vir vazios no plano free) |
| 11 | Dedup de webhook | **Duas camadas**: Upstash Redis (key = `wh:{platform}:sha256(workspace_id + raw_body)`, TTL 24h) + UNIQUE do Postgres como rede de segurança |
| 12 | Multi-tenancy na Fase 1 | **Sem UI**. Seed manual de 1 workspace via SQL |
| 13 | Stack de testes do worker | **Vitest + `@cloudflare/vitest-pool-workers`** (Miniflare embutido) |
| 14 | Realtime no dashboard | **SSR + revalidate manual** na fase 1. Realtime fica pra fase posterior |
| 15 | Criação de `webhook_secrets` | **Seed via Supabase Studio / SQL** na fase 1. UI em `/dashboard/integrations` adiada |
| 16 | CI/CD | **Sem CI** na fase 1. Deploy manual (`wrangler deploy`, `vercel --prod`) |
| 17 | Domínio | **`*.workers.dev` + `*.vercel.app`** na fase 1. Custom domain só quando for testar com cliente |
| 18 | Parsing de `Nome\|ID` no UTM | **Split no último `\|`** (permite nome contendo pipe) |
| 19 | Encryption AES-256-GCM | **IV aleatório por registro** (12 bytes), armazenado em `*_iv` ao lado do payload encriptado. Key única em CF Worker secret |
| 20 | Conteúdo do dashboard fase 1 | **Apenas `/dashboard/conversions`** (tabela). Métricas agregadas só na fase 2, junto com cost data |
| 21 | Janela de busca do `gclid_in_payload` | **90 dias.** Alinha com TTL do cookie `_lt_click` e com a janela padrão de attribution do Google Ads |
| 22 | Bot filtering em `/track/click` | **Drop antes do insert** se UA bater regex `/Googlebot\|bingbot\|AhrefsBot\|SemrushBot\|DuckDuckBot\|YandexBot\|crawler\|spider/i`. Resposta 204 sem efeito colateral |

---

## 5. Mudança de schema necessária

Migration `002_webhook_endpoint_token.sql`:

```sql
ALTER TABLE webhook_secrets
  ADD COLUMN endpoint_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex');

ALTER TABLE webhook_secrets
  ADD CONSTRAINT webhook_secrets_endpoint_token_unique UNIQUE (endpoint_token);

CREATE INDEX idx_webhook_secrets_endpoint_token ON webhook_secrets(endpoint_token);
```

O default usando `pgcrypto.gen_random_bytes` cobre seeds existentes; novos registros podem gerar o token explicitamente na aplicação se preferirmos não depender do default.

---

## 6. Fluxo de Click Capture (detalhe)

1. Página de captura inclui `<script src="https://track.x.com/lt.js" data-workspace="WS_ID" defer></script>`.
2. `/lt.js` (cacheado 1h pelo CF) executa no browser:
   - Lê `data-workspace` da própria tag
   - Lê `URLSearchParams`: `gclid`, `wbraid`, `gbraid`, `gclsrc`, `gad_source`, `gad_campaignid`, `utm_*`
   - Garante cookie `_lt_visitor` (UUID v4, 540 dias, `SameSite=Lax`, `Secure` em prod)
   - Gera novo `click_id` (UUID v4) se houver gclid/wbraid/gbraid OU pelo menos um UTM; senão pula
   - Atualiza `_lt_click` (90 dias) e `_lt_first_click` (se ausente, 540 dias)
   - `POST /track/click` com payload JSON completo (não envia UA — worker lê do header)
   - Reescreve `<a href>` cujo host bate com lista de checkouts conhecidos (kiwify.com.br, pay.hotmart.com, etc.) adicionando `?xcod=<click_id>`
3. Worker em `POST /track/click`:
   - **Bot filter**: se `User-Agent` casar `/Googlebot|bingbot|AhrefsBot|SemrushBot|DuckDuckBot|YandexBot|crawler|spider/i`, responder 204 e abortar (sem insert)
   - Valida `workspace_id` existe (cache em memória do isolate)
   - Faz UA parse + GeoIP via headers CF
   - Faz UTM pipe parse (`Name|123` → `campaign_name_parsed=Name`, `campaign_id_parsed=123`)
   - Insere em `clicks` (idempotência via `click_id UNIQUE`)
   - Resposta `204 No Content`

---

## 7. Fluxo de Webhook (detalhe — Kiwify como exemplo)

1. Kiwify envia `POST /webhook/kiwify/<endpoint_token>` com header HMAC.
2. Worker:
   - Lookup `webhook_secrets` por `endpoint_token` → resolve `workspace_id` + secret descriptografado
   - Valida HMAC SHA256 do body cru contra a assinatura recebida — falha = 401
   - Calcula `dedup_key = sha256(workspace_id + raw_body)`; se já em Upstash (TTL 24h), retorna 200 silencioso
   - Marca `dedup_key` no Upstash imediatamente (TTL 24h)
   - Parse Kiwify → `ConversionDraft { external_order_id, conversion_type, amount, currency, customer_email, customer_phone, click_id_from_payload, gclid_from_payload, occurred_at, raw }`
   - Hash SHA256 de email/phone normalizados (lowercase, trim) para armazenamento
   - Resolve match (Fase 1 — só duas estratégias):
     - Se `xcod` (ou `click_id`) veio no payload → busca em `clicks` → `match_method='click_id'`
     - Senão se `gclid` veio no payload → busca em `clicks` por `gclid` nos últimos **90 dias** → `match_method='gclid_in_payload'`
     - Senão → `click_id=NULL`, `match_method='unmatched'`
   - Insert em `conversions` (UNIQUE workspace+order+type protege contra duplicata mesmo se Upstash falhar)
   - Resposta `200 OK`

> **Nota:** soft-match por email (email+IP+UA dentro de 24h) será adicionado em fase posterior via endpoint `/track/identify`, que recebe email no momento do checkout antes da finalização. Isso permite associar email ↔ click_id de forma determinística antes do webhook chegar, eliminando a heurística de "soft match" que tem maior chance de falso positivo.

Hotmart segue mesmo fluxo, trocando validação HMAC por header `X-Hotmart-Hottok` e mapeando eventos `PURCHASE_APPROVED/REFUNDED/CHARGEBACK/BILLET_PRINTED`.

---

## 8. Frontend mínimo

- `app/layout.tsx`: HTML root, font Inter, providers Tailwind
- `middleware.ts`: refresh de sessão Supabase em toda request
- `/login`: form com email → `signInWithOtp` → mensagem "verifica seu email"
- `(dashboard)/layout.tsx`: server component que checa `getUser()`; redirect `/login` se nulo
- `(dashboard)/dashboard/page.tsx`: placeholder com link pra `/dashboard/conversions`
- `(dashboard)/dashboard/conversions/page.tsx`: server component, `revalidate = 30`. Query Supabase com select join em `offers(name)`. Renderiza `<ConversionsTable>` (shadcn Table) com colunas: data, offer, type, amount, match_method, click_id (curto)
- RLS já cuida do isolamento: usuário só vê conversões dos workspaces que possui

---

## 9. Variáveis de ambiente

**Worker (`wrangler.toml` + secrets):**
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ENCRYPTION_KEY              # 32 bytes hex
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ALLOWED_TRACKING_ORIGINS    # CSV de origens permitidas no /track/click (CORS)
```

**App (`.env.local`):**
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

---

## 10. Critérios de aceite da Fase 1

- [ ] `wrangler dev` responde em `/api/health` e serve `/lt.js`
- [ ] Carregar página local com `?gclid=ABC&utm_campaign=Foo|123` cria linha em `clicks` com tudo parseado
- [ ] Cookie `_lt_click` aparece no browser, `xcod=<click_id>` é injetado em link de teste pra `pay.hotmart.com`
- [ ] Request em `/track/click` com `User-Agent: Googlebot/2.1` é descartada com 204 e **não** insere em `clicks`
- [ ] Webhook Kiwify de teste cria conversão com `match_method='click_id'`
- [ ] Webhook Hotmart de teste cria conversão com `match_method='click_id'`
- [ ] Webhook duplicado (mesmo body em <24h) não cria conversão duplicada
- [ ] Webhook com HMAC inválido retorna 401 e não insere nada
- [ ] Webhook sem `xcod` mas com `gclid` no payload, e click correspondente em até 90 dias, cria conversão com `match_method='gclid_in_payload'`
- [ ] Login magic link funciona local
- [ ] `/dashboard/conversions` mostra as conversões inseridas, RLS bloqueia outro usuário

---

## 11. Fora de escopo (vai pra fases posteriores)

- OAuth Google Ads e sync de campaigns/cost (Fase 2)
- Enhanced Conversions upload (Fase 3)
- Webhooks BuyGoods/ClickBank/Cartpanda/Stripe/Pepper/DigistoreX (Fase 4)
- VSL events `/track/event` e funil (Fase 5)
- 1-1-1 view e saturation indicator (Fase 6)
- UI de criação de workspace, members, billing (Fase 7)
- UI de criação de webhook secrets (Fase 7 ou antes se necessário)
- Custom domain de tracking, CI/CD, alertas
- **Soft-match por email** via endpoint `/track/identify` (captura email no checkout antes do webhook)
