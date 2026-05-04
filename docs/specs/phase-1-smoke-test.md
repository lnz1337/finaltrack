# Fase 1 — Smoke Test E2E (manual)

> Roteiro pra validar a Fase 1 ponta-a-ponta com tudo rodando local. Marca o checkbox conforme cada passo passa. Se algo falhar, abrir issue/diagnóstico antes de fechar a fase.

**Branch:** `feat/fase-1-click-capture`
**Pré-requisito:** automação (72 testes Vitest no worker) já passou — esses smoke steps validam a parte de integração que os testes Miniflare não cobrem (browser, cookies reais, UI, RLS).

---

## Step 1 — Subir tudo

```bash
# terminal 1: supabase
supabase start

# terminal 2: worker
pnpm worker:dev   # http://localhost:8787

# terminal 3: app
pnpm app:dev      # http://localhost:3000
```

**Se o user dev ainda não existe** (DB foi resetada), rodar primeiro:
```bash
pnpm dev:reset
```

- [ ] Supabase: API em `http://127.0.0.1:54321`, Studio em `http://127.0.0.1:54323`
- [ ] Worker: respondendo `200` em `curl http://localhost:8787/api/health`
- [ ] App: rendering `<html>` em `curl -s http://localhost:3000 | head -c 200`

---

## Step 2 — LP de teste com `/lt.js`

Salvar como `C:\Users\lenzi\AppData\Local\Temp\lp.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>LP teste</title></head>
<body>
  <h1>Landing</h1>
  <a id="cta" href="https://pay.kiwify.com.br/checkout/abc">Comprar (Kiwify)</a>
  <a id="cta2" href="https://pay.hotmart.com/checkout/xyz">Comprar (Hotmart)</a>
  <script src="http://localhost:8787/lt.js" data-workspace="00000000-0000-0000-0000-000000000001" defer></script>
</body></html>
```

Servir local:

```bash
npx http-server "C:\Users\lenzi\AppData\Local\Temp" -p 4000 --cors
```

- [ ] Server respondendo em `http://localhost:4000/lp.html`

---

## Step 3 — Click capture funcional

Abrir no navegador:

```
http://localhost:4000/lp.html?gclid=SMOKE_GCLID&utm_source=google&utm_campaign=Smoke|111&utm_content=Adset|222&utm_term=Ad|333
```

DevTools → Application → Cookies (`http://localhost:4000`):

- [ ] `_lt_visitor` presente (UUID)
- [ ] `_lt_click` presente (UUID — é o **xcod** que vamos usar nos webhooks)
- [ ] `_lt_first_click` presente

DevTools → Elements, inspecionar `<a id="cta">`:

- [ ] `href` agora contém `?xcod=<uuid>` (mesmo valor de `_lt_click`)

Studio → tabela `clicks`, filtrar por `gclid='SMOKE_GCLID'`:

- [ ] 1 linha nova
- [ ] `campaign_name_parsed='Smoke'`, `campaign_id_parsed='111'`
- [ ] `adset_name_parsed='Adset'`, `adset_id_parsed='222'`
- [ ] `ad_name_parsed='Ad'`, `ad_id_parsed='333'`
- [ ] `device_type`, `os`, `browser` preenchidos

**Anotar o `click_id` (= xcod) pra usar nos próximos passos.**

---

## Step 4 — Bot filter

```bash
curl -i -X POST http://localhost:8787/track/click \
  -H 'content-type: application/json' \
  -H 'user-agent: Googlebot/2.1' \
  -d '{"workspace_id":"00000000-0000-0000-0000-000000000001","click_id":"smoke_bot","visitor_id":"v","landing_url":"http://lp"}'
```

- [ ] Resposta `204`
- [ ] Studio: nenhuma linha com `click_id='smoke_bot'`

---

## Step 5 — Webhook Kiwify (match_method=click_id)

Substituir `<XCOD>` pelo valor do cookie `_lt_click` capturado no Step 3:

```bash
BODY='{"webhook_event_type":"order_approved","order_id":"SMOKE-K-1","order_status":"paid","created_at":"2026-05-03T13:00:00Z","Customer":{"email":"smoke@kiwify.com","mobile":"+5511900000000"},"Product":{"product_id":"kiwify-product-1"},"Commissions":{"charge_amount":"97.00","currency_type":"BRL"},"TrackingParameters":{"xcod":"<XCOD>","gclid":"SMOKE_GCLID"}}'

SIG=$(node -e "const c=require('crypto');console.log(c.createHmac('sha256','kiwify_test_secret_123').update(process.argv[1]).digest('hex'))" "$BODY")

curl -i -X POST "http://localhost:8787/webhook/kiwify/dev_kiwify_token_aaaaaaaaaaaaaaaa" \
  -H 'content-type: application/json' \
  -H "x-kiwify-signature: $SIG" \
  -d "$BODY"
```

- [ ] Resposta `200`
- [ ] Studio → `conversions`: linha com `external_order_id='SMOKE-K-1'`, `match_method='click_id'`, `click_id` igual ao xcod, `amount=97`, `conversion_type='paid'`

---

## Step 6 — Webhook Kiwify com HMAC inválido

```bash
curl -i -X POST "http://localhost:8787/webhook/kiwify/dev_kiwify_token_aaaaaaaaaaaaaaaa" \
  -H 'content-type: application/json' \
  -H 'x-kiwify-signature: deadbeef' \
  -d "$BODY"
```

- [ ] Resposta `401`

---

## Step 7 — Idempotência

Repetir o curl do Step 5 (mesmo body, mesma assinatura).

- [ ] Resposta `200` (silent ok)
- [ ] Studio: ainda 1 única linha com `external_order_id='SMOKE-K-1'`

---

## Step 8 — Match via gclid_in_payload (sem xcod)

```bash
BODY='{"webhook_event_type":"order_approved","order_id":"SMOKE-K-2","order_status":"paid","created_at":"2026-05-03T13:05:00Z","Customer":{"email":"x@k.com"},"Product":{"product_id":"kiwify-product-1"},"Commissions":{"charge_amount":"97.00","currency_type":"BRL"},"TrackingParameters":{"gclid":"SMOKE_GCLID"}}'

SIG=$(node -e "const c=require('crypto');console.log(c.createHmac('sha256','kiwify_test_secret_123').update(process.argv[1]).digest('hex'))" "$BODY")

curl -i -X POST "http://localhost:8787/webhook/kiwify/dev_kiwify_token_aaaaaaaaaaaaaaaa" \
  -H 'content-type: application/json' \
  -H "x-kiwify-signature: $SIG" \
  -d "$BODY"
```

- [ ] Resposta `200`
- [ ] Studio: nova `conversion` com `match_method='gclid_in_payload'`, `click_id` apontando pro mesmo click do Step 3

---

## Step 9 — Webhook Hotmart (match via external_code)

Voltar à LP com outro `?gclid=SMOKE2` pra forçar novo click. Inspecionar o link Hotmart e copiar o `xcod` injetado.

```bash
BODY='{"id":"smoke-h-1","event":"PURCHASE_APPROVED","creation_date":1746271800000,"data":{"purchase":{"transaction":"SMOKE-H-1","approved_date":1746271800000,"status":"APPROVED","price":{"value":97.0,"currency_value":"BRL"},"tracking":{"external_code":"<XCOD_HOT>"}},"buyer":{"email":"smoke@hot.com"},"product":{"id":"hotmart-product-1"}}}'

curl -i -X POST "http://localhost:8787/webhook/hotmart/dev_hotmart_token_bbbbbbbbbbbbbbbb" \
  -H 'content-type: application/json' \
  -H 'x-hotmart-hottok: hotmart_test_hottok_456' \
  -d "$BODY"
```

- [ ] Resposta `200`
- [ ] Studio: `conversions` tem linha `SMOKE-H-1` com `match_method='click_id'`

---

## Step 10 — Login + dashboard

- [ ] Acessar `http://localhost:3000/dashboard` sem login → redireciona pra `/login`
- [ ] Logar com `dev@finaltrack.local`
- [ ] Inbucket (`http://localhost:54324`) recebe magic link
- [ ] Clicar no link → cai no `/dashboard`
- [ ] Acessar `/dashboard/conversions` → vê as 3 conversões criadas (`SMOKE-K-1`, `SMOKE-K-2`, `SMOKE-H-1`) com tipos e `match_method` corretos
- [ ] Recarregar — dados persistem

---

## Step 11 — RLS

Studio → criar outro user (`outro@local`, auto-confirm). Logar em incógnito.

- [ ] `/dashboard/conversions` → tabela vazia (RLS bloqueia ver dados do `dev@finaltrack.local`)

---

## Step 12 — Fase 1 aprovada

- [ ] Todos os checkboxes acima ✅
- [ ] `pnpm --filter ./worker test` → 72 verde
- [ ] `pnpm --filter ./app build` → 0 erro
- [ ] Commitar este arquivo com `docs: smoke test fase 1 aprovado`

---

## Gaps conhecidos pra prod (não-bloqueantes pra Fase 1)

Da execução documentada em `docs/plans/phase-1-status.md`:

- **`/track/click` sem CORS headers** — em prod, fetch fallback do `sendBeacon` vai falhar cross-origin. Plano declarou `ALLOWED_TRACKING_ORIGINS` mas não wirou. Ajustar antes de pôr no ar.
- **Volatile DEFAULT em migration 002** — re-rodar contra prod com dados existentes vai causar table rewrite. Em prod considerar split em 3 statements (ADD nullable → UPDATE → SET NOT NULL).
- **Hottok comparison não-timing-safe** em webhook-hotmart — upgrade defensivo pra v2.
- **Code duplication ~92%** entre `webhook-kiwify` e `webhook-hotmart` — refatorar pra `processConversion()` se aparecer 3ª plataforma.
- **`auth.users` seed via setup-dev.sh** — não roda em prod (só dev). Em prod o admin cria users via dashboard Supabase ou Auth API.
