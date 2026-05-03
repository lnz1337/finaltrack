# Fase 1 — Click Capture + Webhook Correlation: Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` pra implementar este plano tarefa-por-tarefa. Steps usam checkbox (`- [ ]`).

**Goal:** Entregar Fase 1 do LeoTracker — click capture via `/lt.js`, propagação de `click_id` pra checkout via `xcod`, webhooks Kiwify+Hotmart com correlação determinística (click_id → gclid 90d), dashboard mínimo autenticado listando conversões.

**Architecture:** Monorepo pnpm com worker Cloudflare (TS, multi-file → bundle Wrangler) e Next.js 15 (App Router + Supabase Auth SSR). Banco Postgres no Supabase com RLS. Dedup duplo (Upstash + UNIQUE Postgres). Webhooks identificam workspace via `endpoint_token` no path.

**Tech Stack:** TypeScript, Cloudflare Workers + Wrangler, Vitest + `@cloudflare/vitest-pool-workers` (Miniflare), Supabase (Postgres + Auth via @supabase/ssr), Upstash Redis REST, Next.js 15, Tailwind, shadcn/ui, pnpm workspaces.

**Spec referência:** `docs/specs/phase-1-click-capture.md`

---

## File Structure

Arquivos criados/modificados nesta fase, agrupados por responsabilidade:

**Raiz (workspace):**
- `package.json` — orquestrador pnpm
- `pnpm-workspace.yaml` — declara `worker/` e `app/`
- `.gitignore` — Node/Next/Wrangler/env

**Banco:**
- `migrations/002_webhook_endpoint_token.sql` — adiciona coluna pra rotear webhooks
- `migrations/003_seed_dev.sql` — seed de 1 workspace + 2 webhook_secrets pra dev local

**Worker (`worker/`):**
- `wrangler.toml.example` — template de config (não commitar `wrangler.toml`)
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/types.ts` — tipos compartilhados (`Env`, `ClickRecord`, `ConversionDraft`, `MatchMethod`)
- `src/index.ts` — router principal (switch por método+path)
- `src/routes/health.ts` — `GET /api/health`
- `src/routes/lt-script.ts` — `GET /lt.js` (serve bundle do tracker)
- `src/routes/track-click.ts` — `POST /track/click` (com bot filter)
- `src/routes/webhook-kiwify.ts` — `POST /webhook/kiwify/:endpoint_token`
- `src/routes/webhook-hotmart.ts` — `POST /webhook/hotmart/:endpoint_token`
- `src/parsers/kiwify.ts` — payload Kiwify → `ConversionDraft`
- `src/parsers/hotmart.ts` — payload Hotmart → `ConversionDraft`
- `src/lib/supabase.ts` — fetch wrapper REST
- `src/lib/crypto.ts` — HMAC SHA256, AES-256-GCM, hash SHA256
- `src/lib/cookies.ts` — parse/serialize
- `src/lib/utm.ts` — split `Name|ID` no último pipe
- `src/lib/ua.ts` — regex device/os/browser + bot detection
- `src/lib/geo.ts` — leitura de headers CF
- `src/lib/dedup.ts` — Upstash REST (SET NX EX)
- `src/lib/matching.ts` — click_id direto > gclid_in_payload (90d) > unmatched
- `src/tracker/lt.client.ts` — código IIFE servido em `/lt.js`
- `tests/*.test.ts` — Vitest com pool de workers

**App (`app/`):**
- Scaffold gerado por `create-next-app` (TS, Tailwind, App Router)
- `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`
- `components.json` — config do shadcn
- `.env.local.example`
- `middleware.ts` — refresh de sessão Supabase
- `app/layout.tsx` — root, font Inter
- `app/page.tsx` — landing placeholder
- `app/login/page.tsx` — magic link
- `app/(dashboard)/layout.tsx` — auth guard
- `app/(dashboard)/dashboard/page.tsx` — placeholder
- `app/(dashboard)/dashboard/conversions/page.tsx` — tabela
- `components/ui/*` — gerados via shadcn (button, input, table, card)
- `components/conversions-table.tsx`
- `lib/supabase/{client,server,middleware}.ts`
- `lib/types/database.ts` — gerado via `supabase gen types`

---

## Notas de execução

- **Working directory base:** `C:\Users\lenzi\FinalTrack` (trocar por equivalente Unix se rodar em outra máquina).
- **Pré-requisitos:** Node 20+, pnpm 9+, Wrangler 3+, Supabase CLI 1.x, Docker (pra Supabase local).
- **Idioma:** comentários e UI em PT-BR; nomes de identificadores em inglês (idiomático JS/TS).
- **Commits:** PT-BR, formato Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- **TDD:** sempre teste primeiro pra código com lógica (libs, parsers, matching, routes). Pra arquivos de config/scaffolding, segue padrão "criar + commitar".
- **Não commitar segredos.** `wrangler.toml` (sem o `.example`), `.env.local`, e qualquer dump com tokens ficam no `.gitignore`.

---

## Task 0: Verificar pré-requisitos

**Files:**
- Nenhum (só verificações de ambiente)

- [ ] **Step 1: Verificar versões instaladas**

```bash
node --version       # Esperado: v20.x ou superior
pnpm --version       # Esperado: 9.x
wrangler --version   # Esperado: 3.x
supabase --version   # Esperado: 1.x
docker --version     # Esperado: qualquer recente (necessário pra supabase start)
```

Se algum faltar, instalar antes de prosseguir:
- pnpm: `npm install -g pnpm`
- wrangler: `npm install -g wrangler`
- supabase: ver https://supabase.com/docs/guides/local-development

- [ ] **Step 2: Confirmar que repo está limpo**

```bash
git status
```
Esperado: `working tree clean` (após o último commit do spec).

---

## Task 1: Setup do monorepo pnpm

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (raiz)
- Create: `.gitignore`

- [ ] **Step 1: Criar `pnpm-workspace.yaml`**

```yaml
packages:
  - 'worker'
  - 'app'
```

- [ ] **Step 2: Criar `package.json` raiz**

```json
{
  "name": "finaltrack",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "worker:dev": "pnpm --filter ./worker dev",
    "worker:test": "pnpm --filter ./worker test",
    "worker:deploy": "pnpm --filter ./worker deploy",
    "app:dev": "pnpm --filter ./app dev",
    "app:build": "pnpm --filter ./app build",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local > app/lib/types/database.ts"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  }
}
```

- [ ] **Step 3: Criar `.gitignore`**

```
# Dependencies
node_modules/
.pnp.*

# Build output
.next/
out/
dist/
.wrangler/

# Env / secrets
.env
.env.local
.env.*.local
worker/wrangler.toml
worker/.dev.vars

# Supabase local
supabase/.branches/
supabase/.temp/

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp
```

- [ ] **Step 4: Commitar**

```bash
git add pnpm-workspace.yaml package.json .gitignore
git commit -m "chore: monorepo pnpm com worker e app"
```

---

## Task 2: Inicializar Supabase local + rodar migration inicial

**Files:**
- Create: `supabase/config.toml` (gerado por `supabase init`)

- [ ] **Step 1: Inicializar Supabase no projeto**

```bash
supabase init
```
Esperado: cria pasta `supabase/` com `config.toml` e `seed.sql`.

- [ ] **Step 2: Subir stack local**

```bash
supabase start
```
Esperado: containers do Postgres, Auth, Studio, etc. Anota `API URL`, `anon key`, `service_role key`, `DB URL`.

- [ ] **Step 3: Aplicar migration inicial**

A migration `001_initial.sql` já existe na pasta `migrations/`. Copiar pra estrutura esperada pelo Supabase CLI:

```bash
mkdir -p supabase/migrations
cp migrations/001_initial.sql supabase/migrations/20260503000001_initial.sql
supabase db reset
```
Esperado: `Finished supabase db reset.` Sem erros SQL.

- [ ] **Step 4: Verificar tabelas no Studio**

Abrir http://localhost:54323 (Studio). Confirmar 13 tabelas listadas: `workspaces`, `google_ads_accounts`, `campaigns`, `ad_groups`, `ads`, `offers`, `clicks`, `video_events`, `conversions`, `conversion_uploads`, `cost_data`, `cost_sync_log`, `webhook_secrets`.

- [ ] **Step 5: Commitar config e migration copiada**

```bash
git add supabase/config.toml supabase/migrations/20260503000001_initial.sql
git commit -m "chore: inicializar supabase local + aplicar 001_initial"
```

---

## Task 3: Migration 002 — `endpoint_token` em `webhook_secrets`

**Files:**
- Create: `migrations/002_webhook_endpoint_token.sql`
- Create: `supabase/migrations/20260503000002_webhook_endpoint_token.sql`

- [ ] **Step 1: Escrever migration**

Conteúdo de `migrations/002_webhook_endpoint_token.sql`:

```sql
-- Adiciona endpoint_token a webhook_secrets pra rotear webhooks
-- sem precisar de slug visível ou header customizado.

BEGIN;

ALTER TABLE webhook_secrets
  ADD COLUMN endpoint_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex');

ALTER TABLE webhook_secrets
  ADD CONSTRAINT webhook_secrets_endpoint_token_unique UNIQUE (endpoint_token);

CREATE INDEX idx_webhook_secrets_endpoint_token ON webhook_secrets(endpoint_token);

COMMIT;
```

- [ ] **Step 2: Copiar pra estrutura Supabase e aplicar**

```bash
cp migrations/002_webhook_endpoint_token.sql supabase/migrations/20260503000002_webhook_endpoint_token.sql
supabase db reset
```
Esperado: ambas migrations aplicadas em sequência sem erro.

- [ ] **Step 3: Confirmar coluna criada**

No Studio, abrir `webhook_secrets` → confirmar coluna `endpoint_token TEXT NOT NULL UNIQUE`.

- [ ] **Step 4: Commitar**

```bash
git add migrations/002_webhook_endpoint_token.sql supabase/migrations/20260503000002_webhook_endpoint_token.sql
git commit -m "feat(db): endpoint_token em webhook_secrets pra rotear webhooks"
```

---

## Task 4: Seed de dev — 1 workspace + 2 webhook_secrets

**Files:**
- Create: `migrations/003_seed_dev.sql`
- Modify: `supabase/seed.sql`

> Seed só roda em local (não vai pra prod). Cria 1 workspace owner do user que vamos usar pra testar, mais webhook_secrets de Kiwify e Hotmart com `endpoint_token` previsível pra teste.

- [ ] **Step 1: Criar usuário de teste no Supabase Auth local**

Pelo Studio (http://localhost:54323) → Authentication → Add user:
- Email: `dev@finaltrack.local`
- Auto-confirm: ✓
- Senha: irrelevante (vamos usar magic link em prod, mas pra seed só precisamos do `auth.users.id`)

Anotar o `id` (UUID) gerado.

- [ ] **Step 2: Escrever seed `003_seed_dev.sql`**

Conteúdo (substituir `<USER_ID>` pelo UUID do passo anterior, e `<KIWIFY_SECRET_PLAINTEXT>` / `<HOTMART_SECRET_PLAINTEXT>` por valores de teste):

```sql
-- Seed local — NUNCA rodar em prod.
-- Cria 1 workspace + offers + webhook_secrets com endpoint_token previsível.

BEGIN;

-- Workspace dev
INSERT INTO workspaces (id, name, slug, owner_id, timezone, default_currency)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Dev Workspace',
  'dev',
  '<USER_ID>',
  'America/Sao_Paulo',
  'BRL'
)
ON CONFLICT (id) DO NOTHING;

-- Offer Kiwify de teste
INSERT INTO offers (id, workspace_id, name, checkout_platform, external_product_id, default_currency, cogs_pct)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Té Drenador (Kiwify)',
  'kiwify',
  'kiwify-product-1',
  'BRL',
  0.30
)
ON CONFLICT (id) DO NOTHING;

-- Offer Hotmart de teste
INSERT INTO offers (id, workspace_id, name, checkout_platform, external_product_id, default_currency, cogs_pct)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000001',
  'Té Drenador (Hotmart)',
  'hotmart',
  'hotmart-product-1',
  'BRL',
  0.30
)
ON CONFLICT (id) DO NOTHING;

-- webhook_secrets — secret_encrypted é placeholder; vamos sobrescrever via app real.
-- Pra dev, vamos validar HMAC contra o plaintext direto (definido em wrangler.toml.example como var pública pra dev).
-- endpoint_token previsível pra facilitar curl manual.
INSERT INTO webhook_secrets (workspace_id, platform, secret_encrypted, secret_iv, endpoint_token)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'kiwify',
    'DEV_PLACEHOLDER_ENCRYPTED',
    'DEV_PLACEHOLDER_IV',
    'dev_kiwify_token_aaaaaaaaaaaaaaaa'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'hotmart',
    'DEV_PLACEHOLDER_ENCRYPTED',
    'DEV_PLACEHOLDER_IV',
    'dev_hotmart_token_bbbbbbbbbbbbbbbb'
  )
ON CONFLICT (workspace_id, platform) DO NOTHING;

COMMIT;
```

> **Decisão de implementação:** o handler de webhook em dev **bypassa** decryption do secret e lê plaintext de uma env var (`DEV_KIWIFY_SECRET`, `DEV_HOTMART_SECRET`) quando `ENV === 'development'`. Em prod, faz decrypt real do `secret_encrypted` usando `ENCRYPTION_KEY`. Implementado na Task 17/19.

- [ ] **Step 3: Copiar pra `supabase/seed.sql`**

```bash
cp migrations/003_seed_dev.sql supabase/seed.sql
supabase db reset
```
`supabase db reset` aplica migrations + seed.sql automaticamente.

- [ ] **Step 4: Verificar no Studio**

`workspaces` tem 1 linha. `offers` tem 2. `webhook_secrets` tem 2 com `endpoint_token` legível.

- [ ] **Step 5: Commitar**

```bash
git add migrations/003_seed_dev.sql supabase/seed.sql
git commit -m "chore(db): seed local com workspace + offers + webhook_secrets"
```

---

## Task 5: Worker scaffold — `wrangler.toml`, router, `/api/health`

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml.example`
- Create: `worker/vitest.config.ts`
- Create: `worker/src/types.ts`
- Create: `worker/src/index.ts`
- Create: `worker/src/routes/health.ts`
- Create: `worker/tests/health.test.ts`

- [ ] **Step 1: `worker/package.json`**

```json
{
  "name": "@finaltrack/worker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev --port 8787",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240909.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types/2023-07-01", "vitest/globals"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "jsx": "react",
    "rootDir": "."
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: `worker/wrangler.toml.example`**

```toml
name = "finaltrack-worker"
main = "src/index.ts"
compatibility_date = "2024-09-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ENV = "development"
ALLOWED_TRACKING_ORIGINS = "http://localhost:3000,https://example.com"

# Secrets (rodar `wrangler secret put` em prod, ou .dev.vars em dev):
# SUPABASE_URL
# SUPABASE_SERVICE_ROLE_KEY
# ENCRYPTION_KEY              # 32 bytes hex
# UPSTASH_REDIS_REST_URL
# UPSTASH_REDIS_REST_TOKEN
# DEV_KIWIFY_SECRET           # só em dev
# DEV_HOTMART_SECRET          # só em dev

# Pra dev local, criar arquivo .dev.vars (gitignored) com:
# SUPABASE_URL="http://localhost:54321"
# SUPABASE_SERVICE_ROLE_KEY="<service_role_key_local>"
# ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
# UPSTASH_REDIS_REST_URL=""   # pode ficar vazio em dev se mock
# UPSTASH_REDIS_REST_TOKEN=""
# DEV_KIWIFY_SECRET="kiwify_test_secret_123"
# DEV_HOTMART_SECRET="hotmart_test_hottok_456"
```

- [ ] **Step 4: `worker/vitest.config.ts`**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml.example' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
});
```

- [ ] **Step 5: `worker/src/types.ts`**

```ts
export interface Env {
  ENV: 'development' | 'production';
  ALLOWED_TRACKING_ORIGINS: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ENCRYPTION_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  DEV_KIWIFY_SECRET?: string;
  DEV_HOTMART_SECRET?: string;
}

export type MatchMethod = 'click_id' | 'gclid_in_payload' | 'unmatched';

export type ConversionType =
  | 'pix_generated'
  | 'billet_generated'
  | 'paid'
  | 'refund'
  | 'chargeback'
  | 'abandoned';

export interface ConversionDraft {
  external_order_id: string;
  conversion_type: ConversionType;
  amount: number;
  currency: string;
  customer_email?: string;
  customer_phone?: string;
  customer_first_name?: string;
  customer_last_name?: string;
  click_id_from_payload?: string;
  gclid_from_payload?: string;
  occurred_at: string;
  raw: unknown;
  offer_external_id?: string;
}

export interface ClickRecord {
  click_id: string;
  visitor_id: string;
  workspace_id: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  gclsrc?: string;
  gad_source?: string;
  gad_campaignid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  campaign_id_parsed?: string;
  campaign_name_parsed?: string;
  adset_id_parsed?: string;
  adset_name_parsed?: string;
  ad_id_parsed?: string;
  ad_name_parsed?: string;
  ip?: string;
  user_agent?: string;
  referrer?: string;
  landing_url: string;
  country?: string;
  region?: string;
  city?: string;
  device_type?: string;
  os?: string;
  browser?: string;
}
```

- [ ] **Step 6: `worker/src/routes/health.ts`**

```ts
export function handleHealth(): Response {
  return Response.json({ ok: true, ts: new Date().toISOString() });
}
```

- [ ] **Step 7: `worker/src/index.ts` (router mínimo)**

```ts
import type { Env } from './types';
import { handleHealth } from './routes/health';

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && url.pathname === '/api/health') {
      return handleHealth();
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

- [ ] **Step 8: Teste do `/api/health`**

`worker/tests/health.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /api/health', () => {
  it('responde 200 com ok=true', async () => {
    const res = await SELF.fetch('http://test/api/health');
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; ts: string }>();
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('string');
  });

  it('responde 404 em rota desconhecida', async () => {
    const res = await SELF.fetch('http://test/no-such-path');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 9: Instalar deps e rodar testes**

```bash
cd worker && pnpm install && pnpm test
```
Esperado: 2 testes passam.

- [ ] **Step 10: Verificar dev server**

```bash
pnpm dev
# em outro terminal:
curl http://localhost:8787/api/health
```
Esperado: `{"ok":true,"ts":"..."}`. Parar o dev server (Ctrl+C).

- [ ] **Step 11: Commitar**

```bash
git add worker/
git commit -m "feat(worker): scaffold com router + /api/health + setup vitest"
```

---

## Task 6: `lib/utm.ts` — parser de pipe `Name|ID`

**Files:**
- Create: `worker/src/lib/utm.ts`
- Create: `worker/tests/utm.test.ts`

- [ ] **Step 1: Teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import { parseUtmPipe } from '../src/lib/utm';

describe('parseUtmPipe', () => {
  it('retorna {name, id} quando há pipe', () => {
    expect(parseUtmPipe('Campanha BR|123456789')).toEqual({
      name: 'Campanha BR',
      id: '123456789',
    });
  });

  it('split no último pipe (permite pipe no nome)', () => {
    expect(parseUtmPipe('Campanha|com|pipe|999')).toEqual({
      name: 'Campanha|com|pipe',
      id: '999',
    });
  });

  it('retorna {name} sem id quando não há pipe', () => {
    expect(parseUtmPipe('NomeSimples')).toEqual({ name: 'NomeSimples' });
  });

  it('retorna undefined quando string vazia', () => {
    expect(parseUtmPipe('')).toBeUndefined();
    expect(parseUtmPipe(undefined)).toBeUndefined();
  });

  it('trim de espaços ao redor', () => {
    expect(parseUtmPipe('  Foo | 42 ')).toEqual({ name: 'Foo', id: '42' });
  });
});
```

- [ ] **Step 2: Rodar teste — esperado FAIL**

```bash
pnpm test utm
```
Esperado: erro "Cannot find module '../src/lib/utm'".

- [ ] **Step 3: Implementar `worker/src/lib/utm.ts`**

```ts
export interface ParsedPipe {
  name: string;
  id?: string;
}

export function parseUtmPipe(value: string | undefined): ParsedPipe | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const lastPipe = trimmed.lastIndexOf('|');
  if (lastPipe === -1) {
    return { name: trimmed };
  }

  const name = trimmed.slice(0, lastPipe).trim();
  const id = trimmed.slice(lastPipe + 1).trim();
  return id ? { name, id } : { name };
}
```

- [ ] **Step 4: Rodar testes — esperado PASS**

```bash
pnpm test utm
```
Esperado: 5 passes.

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/utm.ts worker/tests/utm.test.ts
git commit -m "feat(worker): parser utm pipe Name|ID"
```

---

## Task 7: `lib/cookies.ts` — parse e serialize

**Files:**
- Create: `worker/src/lib/cookies.ts`
- Create: `worker/tests/cookies.test.ts`

- [ ] **Step 1: Teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import { parseCookies, serializeCookie } from '../src/lib/cookies';

describe('parseCookies', () => {
  it('parse de header cookie simples', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('decode URL-encoded', () => {
    expect(parseCookies('x=hello%20world')).toEqual({ x: 'hello world' });
  });

  it('aceita header vazio ou null', () => {
    expect(parseCookies('')).toEqual({});
    expect(parseCookies(null)).toEqual({});
  });
});

describe('serializeCookie', () => {
  it('serializa com defaults SameSite=Lax e Path=/', () => {
    const c = serializeCookie('foo', 'bar', { maxAge: 3600 });
    expect(c).toContain('foo=bar');
    expect(c).toContain('Path=/');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Max-Age=3600');
  });

  it('inclui Secure quando flag passa', () => {
    expect(serializeCookie('foo', 'bar', { secure: true })).toContain('Secure');
  });

  it('encoda valor', () => {
    expect(serializeCookie('foo', 'a b')).toContain('foo=a%20b');
  });
});
```

- [ ] **Step 2: Rodar — esperado FAIL**

```bash
pnpm test cookies
```

- [ ] **Step 3: Implementar `worker/src/lib/cookies.ts`**

```ts
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  if (opts.secure) parts.push('Secure');
  if (opts.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}
```

- [ ] **Step 4: Rodar — esperado PASS**

```bash
pnpm test cookies
```

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/cookies.ts worker/tests/cookies.test.ts
git commit -m "feat(worker): parse e serialize de cookies"
```

---

## Task 8: `lib/ua.ts` — parser de UA + bot detection

**Files:**
- Create: `worker/src/lib/ua.ts`
- Create: `worker/tests/ua.test.ts`

- [ ] **Step 1: Teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import { parseUserAgent, isBot } from '../src/lib/ua';

describe('parseUserAgent', () => {
  it('Chrome desktop em macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua)).toEqual({ device_type: 'desktop', os: 'macOS', browser: 'Chrome' });
  });

  it('Safari iPhone (mobile)', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
    expect(parseUserAgent(ua)).toEqual({ device_type: 'mobile', os: 'iOS', browser: 'Safari' });
  });

  it('Chrome em Android tablet', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const r = parseUserAgent(ua);
    expect(r.os).toBe('Android');
    expect(r.browser).toBe('Chrome');
    // tablet detection é best-effort; aceita mobile ou tablet
    expect(['mobile', 'tablet']).toContain(r.device_type);
  });

  it('Edge em Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
    expect(parseUserAgent(ua)).toEqual({ device_type: 'desktop', os: 'Windows', browser: 'Edge' });
  });

  it('UA vazio retorna defaults', () => {
    expect(parseUserAgent('')).toEqual({ device_type: 'desktop', os: 'Other', browser: 'Other' });
    expect(parseUserAgent(undefined)).toEqual({ device_type: 'desktop', os: 'Other', browser: 'Other' });
  });
});

describe('isBot', () => {
  it.each([
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
    'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
    'Mozilla/5.0 (compatible; some-crawler/1.0)',
    'My Custom Spider 1.0',
  ])('detecta bot: %s', (ua) => {
    expect(isBot(ua)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  ])('não detecta humano como bot: %s', (ua) => {
    expect(isBot(ua)).toBe(false);
  });

  it('UA vazio é considerado bot', () => {
    expect(isBot('')).toBe(true);
    expect(isBot(undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar — esperado FAIL**

```bash
pnpm test ua
```

- [ ] **Step 3: Implementar `worker/src/lib/ua.ts`**

```ts
const BOT_RE = /Googlebot|bingbot|AhrefsBot|SemrushBot|DuckDuckBot|YandexBot|crawler|spider/i;

export function isBot(ua: string | undefined | null): boolean {
  if (!ua) return true;
  return BOT_RE.test(ua);
}

export interface UAParsed {
  device_type: 'desktop' | 'mobile' | 'tablet';
  os: 'iOS' | 'Android' | 'macOS' | 'Windows' | 'Linux' | 'Other';
  browser: 'Chrome' | 'Safari' | 'Firefox' | 'Edge' | 'Other';
}

export function parseUserAgent(ua: string | undefined | null): UAParsed {
  if (!ua) return { device_type: 'desktop', os: 'Other', browser: 'Other' };

  let os: UAParsed['os'] = 'Other';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let device_type: UAParsed['device_type'] = 'desktop';
  if (os === 'iOS') {
    device_type = /iPad/i.test(ua) ? 'tablet' : 'mobile';
  } else if (os === 'Android') {
    // tablets Android tipicamente NÃO têm "Mobile" no UA
    device_type = /Mobile/i.test(ua) ? 'mobile' : 'tablet';
  } else if (/Mobile/i.test(ua)) {
    device_type = 'mobile';
  }

  let browser: UAParsed['browser'] = 'Other';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

  return { device_type, os, browser };
}
```

- [ ] **Step 4: Rodar — esperado PASS**

```bash
pnpm test ua
```

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/ua.ts worker/tests/ua.test.ts
git commit -m "feat(worker): parser de user-agent + bot detection"
```

---

## Task 9: `lib/geo.ts` — leitura de headers Cloudflare

**Files:**
- Create: `worker/src/lib/geo.ts`
- Create: `worker/tests/geo.test.ts`

- [ ] **Step 1: Teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import { extractGeo } from '../src/lib/geo';

function makeReq(headers: Record<string, string>): Request {
  return new Request('http://test', { headers });
}

describe('extractGeo', () => {
  it('lê country/region/city dos headers cf-*', () => {
    const req = makeReq({
      'cf-ipcountry': 'BR',
      'cf-region': 'SP',
      'cf-ipcity': 'São Paulo',
      'cf-connecting-ip': '189.45.12.34',
    });
    expect(extractGeo(req)).toEqual({
      country: 'BR',
      region: 'SP',
      city: 'São Paulo',
      ip: '189.45.12.34',
    });
  });

  it('retorna campos undefined quando header ausente', () => {
    const req = makeReq({});
    expect(extractGeo(req)).toEqual({
      country: undefined,
      region: undefined,
      city: undefined,
      ip: undefined,
    });
  });

  it('ignora valores XX (CF para anônimos)', () => {
    const req = makeReq({ 'cf-ipcountry': 'XX' });
    expect(extractGeo(req).country).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar — FAIL**

- [ ] **Step 3: Implementar `worker/src/lib/geo.ts`**

```ts
export interface GeoInfo {
  country?: string;
  region?: string;
  city?: string;
  ip?: string;
}

export function extractGeo(req: Request): GeoInfo {
  const h = req.headers;
  const country = h.get('cf-ipcountry') ?? undefined;
  const region = h.get('cf-region') ?? undefined;
  const city = h.get('cf-ipcity') ?? undefined;
  const ip = h.get('cf-connecting-ip') ?? undefined;
  return {
    country: country && country !== 'XX' ? country : undefined,
    region: region || undefined,
    city: city || undefined,
    ip: ip || undefined,
  };
}
```

- [ ] **Step 4: Rodar — PASS**

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/geo.ts worker/tests/geo.test.ts
git commit -m "feat(worker): extrair geo dos headers cloudflare"
```

---

## Task 10: `lib/crypto.ts` — HMAC, AES-256-GCM, SHA256

**Files:**
- Create: `worker/src/lib/crypto.ts`
- Create: `worker/tests/crypto.test.ts`

- [ ] **Step 1: Teste falhando**

```ts
import { describe, it, expect } from 'vitest';
import {
  hmacSha256Hex,
  verifyHmacSha256,
  sha256Hex,
  hashEmail,
  encryptAesGcm,
  decryptAesGcm,
} from '../src/lib/crypto';

describe('hmacSha256Hex', () => {
  it('produz hex previsível', async () => {
    const sig = await hmacSha256Hex('secret', 'hello');
    expect(sig).toBe('88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b');
  });
});

describe('verifyHmacSha256', () => {
  it('aceita assinatura correta', async () => {
    const ok = await verifyHmacSha256('secret', 'hello', '88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b');
    expect(ok).toBe(true);
  });

  it('rejeita assinatura errada', async () => {
    expect(await verifyHmacSha256('secret', 'hello', 'deadbeef')).toBe(false);
  });

  it('comparação é case-insensitive em hex', async () => {
    expect(await verifyHmacSha256('secret', 'hello', '88AAB3EDE8D3ADF94D26AB90D3BAFD4A2083070C3BCCE9C014EE04A443847C0B')).toBe(true);
  });
});

describe('sha256Hex / hashEmail', () => {
  it('sha256Hex de string', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashEmail normaliza (lowercase + trim)', async () => {
    const a = await hashEmail('  Foo@BAR.com ');
    const b = await hashEmail('foo@bar.com');
    expect(a).toBe(b);
  });
});

describe('AES-GCM round-trip', () => {
  it('encrypt → decrypt recupera plaintext', async () => {
    const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 32 bytes hex
    const plaintext = 'meu segredo do kiwify';
    const { ciphertext, iv } = await encryptAesGcm(key, plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(iv.length).toBe(24); // 12 bytes hex
    const back = await decryptAesGcm(key, ciphertext, iv);
    expect(back).toBe(plaintext);
  });
});
```

- [ ] **Step 2: Rodar — FAIL**

- [ ] **Step 3: Implementar `worker/src/lib/crypto.ts`**

```ts
const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(sig);
}

export async function verifyHmacSha256(secret: string, message: string, signatureHex: string): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, message);
  return timingSafeEqualHex(expected, signatureHex.toLowerCase());
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return bytesToHex(buf);
}

export function hashEmail(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase());
}

export function hashPhone(phone: string): Promise<string> {
  // remove tudo que não for dígito antes de hashear (E.164-friendly)
  const digits = phone.replace(/\D+/g, '');
  return sha256Hex(digits);
}

export interface EncryptedPayload {
  ciphertext: string; // hex
  iv: string; // hex (12 bytes)
}

async function importAesKey(keyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptAesGcm(keyHex: string, plaintext: string): Promise<EncryptedPayload> {
  const key = await importAesKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { ciphertext: bytesToHex(ct), iv: bytesToHex(iv) };
}

export async function decryptAesGcm(keyHex: string, ciphertextHex: string, ivHex: string): Promise<string> {
  const key = await importAesKey(keyHex);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(ivHex) },
    key,
    hexToBytes(ciphertextHex)
  );
  return dec.decode(pt);
}
```

- [ ] **Step 4: Rodar — PASS**

```bash
pnpm test crypto
```

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/crypto.ts worker/tests/crypto.test.ts
git commit -m "feat(worker): hmac/sha256/aes-gcm helpers"
```

---

## Task 11: `lib/supabase.ts` — REST wrapper com `service_role`

**Files:**
- Create: `worker/src/lib/supabase.ts`
- Create: `worker/tests/supabase.test.ts`

> Em vez de mockar fetch, vamos rodar contra Supabase local (já está up). Os testes inserem em uma tabela de scratch e limpam depois — TDD honesto, sem mocks.

- [ ] **Step 1: Teste de integração**

```ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../src/lib/supabase';

const TEST_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

beforeAll(() => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar em .dev.vars');
  }
});

describe('createSupabaseClient', () => {
  const sb = createSupabaseClient(env);

  afterEach(async () => {
    // limpa qualquer click inserido pelos testes
    await sb.delete('clicks', { workspace_id: `eq.${TEST_WORKSPACE_ID}`, click_id: 'like.test_*' });
  });

  it('select retorna array', async () => {
    const rows = await sb.select<{ id: string }>('workspaces', { id: `eq.${TEST_WORKSPACE_ID}`, select: 'id' });
    expect(rows.length).toBe(1);
  });

  it('insert single row', async () => {
    await sb.insert('clicks', {
      click_id: 'test_insert_1',
      visitor_id: 'v1',
      workspace_id: TEST_WORKSPACE_ID,
      landing_url: 'http://test/lp',
    });
    const rows = await sb.select<{ click_id: string }>('clicks', { click_id: 'eq.test_insert_1', select: 'click_id' });
    expect(rows[0].click_id).toBe('test_insert_1');
  });

  it('insert idempotente em conflito (onConflict)', async () => {
    const row = {
      click_id: 'test_insert_2',
      visitor_id: 'v1',
      workspace_id: TEST_WORKSPACE_ID,
      landing_url: 'http://test/lp',
    };
    await sb.insert('clicks', row);
    // segunda inserção deve não jogar (vai retornar 200/204 silenciosa via Prefer: resolution=ignore-duplicates)
    await sb.insert('clicks', row, { onConflict: 'click_id' });
    const rows = await sb.select<{ click_id: string }>('clicks', { click_id: 'eq.test_insert_2', select: 'click_id' });
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Step 2: Garantir `.dev.vars` existe com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`**

Se ainda não existe, criar `worker/.dev.vars` (gitignored) copiando os valores do `supabase status`:

```bash
supabase status
# copiar API URL e service_role key
```

`worker/.dev.vars`:
```
SUPABASE_URL="http://localhost:54321"
SUPABASE_SERVICE_ROLE_KEY="<service_role_key_from_supabase_status>"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""
DEV_KIWIFY_SECRET="kiwify_test_secret_123"
DEV_HOTMART_SECRET="hotmart_test_hottok_456"
```

- [ ] **Step 3: Rodar — FAIL**

- [ ] **Step 4: Implementar `worker/src/lib/supabase.ts`**

```ts
import type { Env } from '../types';

export interface InsertOptions {
  onConflict?: string; // nome da coluna pra ignorar duplicatas
}

export interface SupabaseClient {
  select<T = unknown>(table: string, query: Record<string, string>): Promise<T[]>;
  insert<T = unknown>(table: string, row: T | T[], opts?: InsertOptions): Promise<void>;
  delete(table: string, query: Record<string, string>): Promise<void>;
}

export function createSupabaseClient(env: Env): SupabaseClient {
  const baseUrl = env.SUPABASE_URL.replace(/\/$/, '');
  const headers = (extra: Record<string, string> = {}): HeadersInit => ({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  });

  function buildQuery(query: Record<string, string>): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) params.set(k, v);
    const s = params.toString();
    return s ? `?${s}` : '';
  }

  return {
    async select<T = unknown>(table: string, query: Record<string, string>): Promise<T[]> {
      const url = `${baseUrl}/rest/v1/${table}${buildQuery(query)}`;
      const res = await fetch(url, { method: 'GET', headers: headers() });
      if (!res.ok) throw new Error(`Supabase select falhou ${res.status}: ${await res.text()}`);
      return (await res.json()) as T[];
    },

    async insert<T = unknown>(table: string, row: T | T[], opts: InsertOptions = {}): Promise<void> {
      const url = `${baseUrl}/rest/v1/${table}`;
      const prefer = opts.onConflict
        ? 'resolution=ignore-duplicates,return=minimal'
        : 'return=minimal';
      const extraHeaders: Record<string, string> = { Prefer: prefer };
      if (opts.onConflict) extraHeaders['on-conflict'] = opts.onConflict;
      const res = await fetch(url + (opts.onConflict ? `?on_conflict=${opts.onConflict}` : ''), {
        method: 'POST',
        headers: headers(extraHeaders),
        body: JSON.stringify(Array.isArray(row) ? row : [row]),
      });
      if (!res.ok && res.status !== 201 && res.status !== 200 && res.status !== 204) {
        throw new Error(`Supabase insert falhou ${res.status}: ${await res.text()}`);
      }
    },

    async delete(table: string, query: Record<string, string>): Promise<void> {
      const url = `${baseUrl}/rest/v1/${table}${buildQuery(query)}`;
      const res = await fetch(url, { method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }) });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Supabase delete falhou ${res.status}: ${await res.text()}`);
      }
    },
  };
}
```

- [ ] **Step 5: Rodar — PASS**

```bash
pnpm test supabase
```

- [ ] **Step 6: Commitar**

```bash
git add worker/src/lib/supabase.ts worker/tests/supabase.test.ts worker/.dev.vars.example
git commit -m "feat(worker): supabase rest wrapper com service_role"
```

> Nota: criar também `worker/.dev.vars.example` com mesmos campos do `.dev.vars` mas sem valores reais — pra novos devs saberem o que configurar.

---

## Task 12: `lib/dedup.ts` — Upstash Redis (SET NX EX)

**Files:**
- Create: `worker/src/lib/dedup.ts`
- Create: `worker/tests/dedup.test.ts`

> Em dev a `UPSTASH_REDIS_REST_URL` está vazia. O wrapper deve no-op em dev (sempre retornar `false` = não duplicado) e logar warning. Pra teste real, criamos uma instância Upstash gratuita (passo opcional descrito no commit).

- [ ] **Step 1: Teste**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createDedup } from '../src/lib/dedup';

describe('createDedup', () => {
  it('quando URL vazia, sempre retorna isDuplicate=false (no-op em dev)', async () => {
    const dedup = createDedup({ url: '', token: '' });
    expect(await dedup.checkAndMark('any-key', 60)).toBe(false);
    expect(await dedup.checkAndMark('any-key', 60)).toBe(false);
  });

  it('chama Upstash com SET NX EX quando URL configurada', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: 'OK' }), { status: 200 }));
    const dedup = createDedup({ url: 'https://test.upstash.io', token: 'tok', fetchImpl: fetchMock });

    expect(await dedup.checkAndMark('k1', 86400)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/set/k1/1');
    expect(String(url)).toContain('NX=true');
    expect(String(url)).toContain('EX=86400');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('retorna isDuplicate=true quando Upstash responde result=null', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 }));
    const dedup = createDedup({ url: 'https://test.upstash.io', token: 'tok', fetchImpl: fetchMock });
    expect(await dedup.checkAndMark('k', 86400)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar — FAIL**

- [ ] **Step 3: Implementar `worker/src/lib/dedup.ts`**

```ts
export interface DedupConfig {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface Dedup {
  /**
   * Tenta marcar a chave com TTL. Retorna true se já existia (duplicado),
   * false se foi marcada com sucesso (primeira vez).
   */
  checkAndMark(key: string, ttlSeconds: number): Promise<boolean>;
}

export function createDedup(cfg: DedupConfig): Dedup {
  const { url, token } = cfg;
  const fetchImpl = cfg.fetchImpl ?? fetch;

  if (!url) {
    return {
      async checkAndMark() {
        return false;
      },
    };
  }

  return {
    async checkAndMark(key: string, ttlSeconds: number): Promise<boolean> {
      const safeKey = encodeURIComponent(key);
      const u = `${url.replace(/\/$/, '')}/set/${safeKey}/1?NX=true&EX=${ttlSeconds}`;
      const res = await fetchImpl(u, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Em caso de erro do Upstash, fail open (não bloqueia webhook). UNIQUE do Postgres protege.
        console.error('[dedup] upstash error', res.status, await res.text());
        return false;
      }
      const body = (await res.json()) as { result: string | null };
      return body.result === null; // null = NX falhou = chave já existia
    },
  };
}
```

- [ ] **Step 4: Rodar — PASS**

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/dedup.ts worker/tests/dedup.test.ts
git commit -m "feat(worker): dedup via upstash redis com fail-open"
```

---

## Task 13: `lib/matching.ts` — click_id direto > gclid 90d > unmatched

**Files:**
- Create: `worker/src/lib/matching.ts`
- Create: `worker/tests/matching.test.ts`

- [ ] **Step 1: Teste de integração**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createSupabaseClient } from '../src/lib/supabase';
import { matchConversion } from '../src/lib/matching';

const WS = '00000000-0000-0000-0000-000000000001';
const sb = createSupabaseClient(env);

async function seedClick(opts: { click_id: string; gclid?: string; clicked_at?: string }) {
  await sb.insert('clicks', {
    click_id: opts.click_id,
    visitor_id: 'vmatch',
    workspace_id: WS,
    landing_url: 'http://test/lp',
    gclid: opts.gclid,
    clicked_at: opts.clicked_at,
  });
}

beforeEach(async () => {
  await sb.delete('clicks', { workspace_id: `eq.${WS}`, click_id: 'like.match_*' });
});

describe('matchConversion', () => {
  it('match_method=click_id quando click_id_from_payload existe', async () => {
    await seedClick({ click_id: 'match_a', gclid: 'GA1' });
    const r = await matchConversion(sb, WS, { click_id_from_payload: 'match_a', gclid_from_payload: 'GA1' });
    expect(r).toEqual({ click_id: 'match_a', match_method: 'click_id' });
  });

  it('match_method=gclid_in_payload quando só gclid bate', async () => {
    await seedClick({ click_id: 'match_b', gclid: 'GB1' });
    const r = await matchConversion(sb, WS, { gclid_from_payload: 'GB1' });
    expect(r).toEqual({ click_id: 'match_b', match_method: 'gclid_in_payload' });
  });

  it('match_method=unmatched quando nada bate', async () => {
    const r = await matchConversion(sb, WS, { gclid_from_payload: 'NUNCA_VISTO' });
    expect(r).toEqual({ click_id: null, match_method: 'unmatched' });
  });

  it('gclid fora da janela de 90 dias não bate', async () => {
    const old = new Date(Date.now() - 100 * 86400_000).toISOString();
    await seedClick({ click_id: 'match_c', gclid: 'GC1', clicked_at: old });
    const r = await matchConversion(sb, WS, { gclid_from_payload: 'GC1' });
    expect(r.match_method).toBe('unmatched');
  });

  it('click_id no payload tem prioridade mesmo se inválido (não cai pra gclid)', async () => {
    await seedClick({ click_id: 'match_d', gclid: 'GD1' });
    const r = await matchConversion(sb, WS, { click_id_from_payload: 'naoexiste', gclid_from_payload: 'GD1' });
    // click_id_from_payload existe no payload mas não bate em clicks → cai pro fallback
    expect(r.match_method).toBe('gclid_in_payload');
    expect(r.click_id).toBe('match_d');
  });
});
```

- [ ] **Step 2: Rodar — FAIL**

- [ ] **Step 3: Implementar `worker/src/lib/matching.ts`**

```ts
import type { MatchMethod } from '../types';
import type { SupabaseClient } from './supabase';

export interface MatchInput {
  click_id_from_payload?: string;
  gclid_from_payload?: string;
}

export interface MatchResult {
  click_id: string | null;
  match_method: MatchMethod;
}

const NINETY_DAYS_MS = 90 * 86400_000;

export async function matchConversion(
  sb: SupabaseClient,
  workspaceId: string,
  input: MatchInput
): Promise<MatchResult> {
  // 1. click_id direto
  if (input.click_id_from_payload) {
    const rows = await sb.select<{ click_id: string }>('clicks', {
      workspace_id: `eq.${workspaceId}`,
      click_id: `eq.${input.click_id_from_payload}`,
      select: 'click_id',
      limit: '1',
    });
    if (rows.length > 0) {
      return { click_id: rows[0].click_id, match_method: 'click_id' };
    }
  }

  // 2. gclid in payload (90d)
  if (input.gclid_from_payload) {
    const since = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
    const rows = await sb.select<{ click_id: string }>('clicks', {
      workspace_id: `eq.${workspaceId}`,
      gclid: `eq.${input.gclid_from_payload}`,
      clicked_at: `gte.${since}`,
      select: 'click_id',
      order: 'clicked_at.desc',
      limit: '1',
    });
    if (rows.length > 0) {
      return { click_id: rows[0].click_id, match_method: 'gclid_in_payload' };
    }
  }

  return { click_id: null, match_method: 'unmatched' };
}
```

- [ ] **Step 4: Rodar — PASS**

- [ ] **Step 5: Commitar**

```bash
git add worker/src/lib/matching.ts worker/tests/matching.test.ts
git commit -m "feat(worker): matching click_id > gclid_in_payload (90d)"
```

---

## Task 14: `tracker/lt.client.ts` — código bundlado servido em `/lt.js`

**Files:**
- Create: `worker/src/tracker/lt.client.ts`
- Create: `worker/src/tracker/checkout-hosts.ts`

> Este arquivo NÃO roda no worker — vai ser embutido como string no `routes/lt-script.ts` e servido ao browser. Por isso, evita imports do runtime do worker. Mantém zero deps.

- [ ] **Step 1: Criar `worker/src/tracker/checkout-hosts.ts`**

```ts
// Hosts de checkout em que vamos reescrever links pra adicionar ?xcod=<click_id>.
// Manter conservador — só hosts publicamente conhecidos.
export const CHECKOUT_HOSTS = [
  'kiwify.com.br',
  'kiwify.com',
  'pay.kiwify.com.br',
  'pay.hotmart.com',
  'hotmart.com',
];
```

- [ ] **Step 2: Criar `worker/src/tracker/lt.client.ts`**

```ts
import { CHECKOUT_HOSTS } from './checkout-hosts';

/**
 * Esta função é serializada em string e servida em /lt.js.
 * Roda no browser. Evite usar features do worker runtime.
 */
export const LT_CLIENT_SOURCE = `
(function () {
  if (window.__LT_INIT__) return;
  window.__LT_INIT__ = true;

  function getScriptTag() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i];
      if (s.src && s.src.indexOf('/lt.js') !== -1 && s.dataset && s.dataset.workspace) return s;
    }
    return null;
  }

  function uuidv4() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function setCookie(name, value, maxAgeSec) {
    var s = name + '=' + encodeURIComponent(value) + '; path=/; max-age=' + maxAgeSec + '; SameSite=Lax';
    if (location.protocol === 'https:') s += '; Secure';
    document.cookie = s;
  }

  var tag = getScriptTag();
  if (!tag) return;
  var workspaceId = tag.dataset.workspace;
  var workerOrigin = (function () {
    try { return new URL(tag.src).origin; } catch (e) { return ''; }
  })();
  if (!workspaceId || !workerOrigin) return;

  var qs = new URLSearchParams(location.search);
  var trackingFields = ['gclid','wbraid','gbraid','gclsrc','gad_source','gad_campaignid','utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  var hasAnyTracking = trackingFields.some(function (f) { return qs.has(f); });

  // visitor cookie sempre
  var visitorId = getCookie('_lt_visitor');
  if (!visitorId) {
    visitorId = uuidv4();
    setCookie('_lt_visitor', visitorId, 540 * 86400);
  }

  var clickId = getCookie('_lt_click');
  if (hasAnyTracking) {
    clickId = uuidv4();
    setCookie('_lt_click', clickId, 90 * 86400);
    if (!getCookie('_lt_first_click')) {
      setCookie('_lt_first_click', clickId, 540 * 86400);
    }

    var payload = {
      workspace_id: workspaceId,
      click_id: clickId,
      visitor_id: visitorId,
      landing_url: location.href,
      referrer: document.referrer || null,
    };
    trackingFields.forEach(function (f) {
      var v = qs.get(f);
      if (v) payload[f] = v;
    });

    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(workerOrigin + '/track/click', new Blob([body], { type: 'application/json' }));
      } else {
        fetch(workerOrigin + '/track/click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          credentials: 'omit',
        });
      }
    } catch (e) {}
  }

  // Reescrita de links de checkout pra propagar xcod
  if (clickId) {
    var hosts = ${JSON.stringify(CHECKOUT_HOSTS)};
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      try {
        var u = new URL(a.href, location.href);
        for (var i = 0; i < hosts.length; i++) {
          if (u.hostname === hosts[i] || u.hostname.endsWith('.' + hosts[i])) {
            if (!u.searchParams.has('xcod')) {
              u.searchParams.set('xcod', clickId);
              a.href = u.toString();
            }
            break;
          }
        }
      } catch (err) {}
    }, true);
  }
})();
`.trim();
```

- [ ] **Step 3: Sem teste unitário pro client (testado e2e via task 15 + smoke). Commitar**

```bash
git add worker/src/tracker/
git commit -m "feat(worker): tracker /lt.js com captura, cookies e link rewrite"
```

---

## Task 15: `routes/lt-script.ts` — serve `/lt.js` cacheado

**Files:**
- Create: `worker/src/routes/lt-script.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/lt-script.test.ts`

- [ ] **Step 1: Teste falhando**

```ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /lt.js', () => {
  it('responde 200 com Content-Type js e Cache-Control 1h', async () => {
    const res = await SELF.fetch('http://test/lt.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
    const body = await res.text();
    expect(body).toContain('__LT_INIT__');
    expect(body).toContain('_lt_visitor');
  });
});
```

- [ ] **Step 2: Implementar `worker/src/routes/lt-script.ts`**

```ts
import { LT_CLIENT_SOURCE } from '../tracker/lt.client';

export function handleLtScript(): Response {
  return new Response(LT_CLIENT_SOURCE, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
```

- [ ] **Step 3: Modificar `worker/src/index.ts` pra adicionar a rota**

```ts
import type { Env } from './types';
import { handleHealth } from './routes/health';
import { handleLtScript } from './routes/lt-script';

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && url.pathname === '/api/health') return handleHealth();
    if (method === 'GET' && url.pathname === '/lt.js') return handleLtScript();

    return new Response('Not Found', { status: 404 });
  },
};
```

- [ ] **Step 4: Rodar — PASS**

```bash
pnpm test lt-script
```

- [ ] **Step 5: Commitar**

```bash
git add worker/src/routes/lt-script.ts worker/src/index.ts worker/tests/lt-script.test.ts
git commit -m "feat(worker): rota /lt.js servindo tracker cacheado 1h"
```

---

## Task 16: `routes/track-click.ts` — POST /track/click com bot filter

**Files:**
- Create: `worker/src/routes/track-click.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/track-click.test.ts`

- [ ] **Step 1: Teste de integração**

```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseClient } from '../src/lib/supabase';

const WS = '00000000-0000-0000-0000-000000000001';
const sb = createSupabaseClient(env);

beforeEach(async () => {
  await sb.delete('clicks', { workspace_id: `eq.${WS}`, click_id: 'like.tc_*' });
});

const HUMAN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('POST /track/click', () => {
  it('insere click válido com UTMs parsed', async () => {
    const res = await SELF.fetch('http://test/track/click', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': HUMAN_UA,
        'cf-ipcountry': 'BR',
        'cf-region': 'SP',
        'cf-ipcity': 'São Paulo',
        'cf-connecting-ip': '189.45.12.34',
      },
      body: JSON.stringify({
        workspace_id: WS,
        click_id: 'tc_1',
        visitor_id: 'vTC',
        landing_url: 'http://lp/?gclid=ABC&utm_campaign=Foo|123&utm_content=Adset|456&utm_term=Ad|789',
        gclid: 'ABC',
        utm_source: 'google',
        utm_campaign: 'Foo|123',
        utm_content: 'Adset|456',
        utm_term: 'Ad|789',
      }),
    });
    expect(res.status).toBe(204);

    const rows = await sb.select<any>('clicks', {
      click_id: 'eq.tc_1',
      select: 'click_id,gclid,campaign_name_parsed,campaign_id_parsed,adset_name_parsed,adset_id_parsed,ad_name_parsed,ad_id_parsed,country,city,device_type,browser',
    });
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      gclid: 'ABC',
      campaign_name_parsed: 'Foo',
      campaign_id_parsed: '123',
      adset_name_parsed: 'Adset',
      adset_id_parsed: '456',
      ad_name_parsed: 'Ad',
      ad_id_parsed: '789',
      country: 'BR',
      city: 'São Paulo',
      device_type: 'desktop',
      browser: 'Chrome',
    });
  });

  it('descarta request com UA Googlebot (204 sem insert)', async () => {
    const res = await SELF.fetch('http://test/track/click', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      },
      body: JSON.stringify({ workspace_id: WS, click_id: 'tc_bot', visitor_id: 'v', landing_url: 'http://lp' }),
    });
    expect(res.status).toBe(204);
    const rows = await sb.select<any>('clicks', { click_id: 'eq.tc_bot', select: 'click_id' });
    expect(rows.length).toBe(0);
  });

  it('rejeita 400 sem workspace_id', async () => {
    const res = await SELF.fetch('http://test/track/click', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': HUMAN_UA },
      body: JSON.stringify({ click_id: 'tc_x', visitor_id: 'v', landing_url: 'http://lp' }),
    });
    expect(res.status).toBe(400);
  });

  it('idempotente em click_id duplicado', async () => {
    const body = JSON.stringify({ workspace_id: WS, click_id: 'tc_dup', visitor_id: 'v', landing_url: 'http://lp', gclid: 'X' });
    const headers = { 'content-type': 'application/json', 'user-agent': HUMAN_UA };
    const r1 = await SELF.fetch('http://test/track/click', { method: 'POST', headers, body });
    const r2 = await SELF.fetch('http://test/track/click', { method: 'POST', headers, body });
    expect(r1.status).toBe(204);
    expect(r2.status).toBe(204);
    const rows = await sb.select<any>('clicks', { click_id: 'eq.tc_dup', select: 'click_id' });
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Step 2: Implementar `worker/src/routes/track-click.ts`**

```ts
import type { Env, ClickRecord } from '../types';
import { createSupabaseClient } from '../lib/supabase';
import { isBot, parseUserAgent } from '../lib/ua';
import { extractGeo } from '../lib/geo';
import { parseUtmPipe } from '../lib/utm';

interface ClickPayload {
  workspace_id?: string;
  click_id?: string;
  visitor_id?: string;
  landing_url?: string;
  referrer?: string | null;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  gclsrc?: string;
  gad_source?: string;
  gad_campaignid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

export async function handleTrackClick(req: Request, env: Env): Promise<Response> {
  const ua = req.headers.get('user-agent') ?? '';

  // Bot filter — antes de qualquer parse/IO
  if (isBot(ua)) {
    return new Response(null, { status: 204 });
  }

  if (req.headers.get('content-type')?.includes('application/json') === false &&
      req.headers.get('content-type')?.includes('text/plain') === false) {
    // sendBeacon manda como text/plain; aceitar ambos
  }

  let body: ClickPayload;
  try {
    body = await req.json<ClickPayload>();
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  if (!body.workspace_id || !body.click_id || !body.visitor_id || !body.landing_url) {
    return new Response('missing required fields', { status: 400 });
  }

  const geo = extractGeo(req);
  const uaParsed = parseUserAgent(ua);
  const campaignParsed = parseUtmPipe(body.utm_campaign);
  const adsetParsed = parseUtmPipe(body.utm_content);
  const adParsed = parseUtmPipe(body.utm_term);

  const record: ClickRecord = {
    click_id: body.click_id,
    visitor_id: body.visitor_id,
    workspace_id: body.workspace_id,
    gclid: body.gclid,
    wbraid: body.wbraid,
    gbraid: body.gbraid,
    gclsrc: body.gclsrc,
    gad_source: body.gad_source,
    gad_campaignid: body.gad_campaignid,
    utm_source: body.utm_source,
    utm_medium: body.utm_medium,
    utm_campaign: body.utm_campaign,
    utm_content: body.utm_content,
    utm_term: body.utm_term,
    campaign_name_parsed: campaignParsed?.name,
    campaign_id_parsed: campaignParsed?.id,
    adset_name_parsed: adsetParsed?.name,
    adset_id_parsed: adsetParsed?.id,
    ad_name_parsed: adParsed?.name,
    ad_id_parsed: adParsed?.id,
    landing_url: body.landing_url,
    referrer: body.referrer ?? undefined,
    user_agent: ua,
    ip: geo.ip,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    device_type: uaParsed.device_type,
    os: uaParsed.os,
    browser: uaParsed.browser,
  };

  const sb = createSupabaseClient(env);
  await sb.insert('clicks', record, { onConflict: 'click_id' });

  return new Response(null, { status: 204 });
}
```

- [ ] **Step 3: Modificar `worker/src/index.ts`**

```ts
import type { Env } from './types';
import { handleHealth } from './routes/health';
import { handleLtScript } from './routes/lt-script';
import { handleTrackClick } from './routes/track-click';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && url.pathname === '/api/health') return handleHealth();
    if (method === 'GET' && url.pathname === '/lt.js') return handleLtScript();
    if (method === 'POST' && url.pathname === '/track/click') return handleTrackClick(request, env);

    return new Response('Not Found', { status: 404 });
  },
};
```

- [ ] **Step 4: Rodar — PASS**

```bash
pnpm test track-click
```

- [ ] **Step 5: Commitar**

```bash
git add worker/src/routes/track-click.ts worker/src/index.ts worker/tests/track-click.test.ts
git commit -m "feat(worker): /track/click com bot filter, geo, ua e utm pipe"
```

---

## Task 17: `parsers/kiwify.ts` — payload Kiwify → ConversionDraft

**Files:**
- Create: `worker/src/parsers/kiwify.ts`
- Create: `worker/tests/fixtures/kiwify-order-approved.json`
- Create: `worker/tests/fixtures/kiwify-pix-created.json`
- Create: `worker/tests/fixtures/kiwify-refund.json`
- Create: `worker/tests/kiwify.test.ts`

> **Atenção:** o schema exato do Kiwify pode variar. Os fixtures abaixo são representativos — ao integrar com produção, validar contra um payload real e ajustar o parser. O importante é a forma de mapeamento.

- [ ] **Step 1: Fixtures**

`worker/tests/fixtures/kiwify-order-approved.json`:
```json
{
  "webhook_event_type": "order_approved",
  "order_id": "ORD-AAA-001",
  "order_status": "paid",
  "created_at": "2026-05-03T12:30:00Z",
  "Customer": {
    "email": "Maria@EXEMPLO.com",
    "mobile": "+55 11 99999-1111",
    "first_name": "Maria",
    "last_name": "Silva"
  },
  "Product": { "product_id": "kiwify-product-1", "product_name": "Té Drenador" },
  "Commissions": { "charge_amount": "97.00", "currency_type": "BRL" },
  "TrackingParameters": {
    "utm_source": "google",
    "utm_campaign": "Foo|123",
    "xcod": "click_xyz_789",
    "gclid": "GCLID_AAA"
  }
}
```

`worker/tests/fixtures/kiwify-pix-created.json`:
```json
{
  "webhook_event_type": "pix_created",
  "order_id": "ORD-AAA-002",
  "order_status": "waiting_payment",
  "created_at": "2026-05-03T12:31:00Z",
  "Customer": { "email": "joao@exemplo.com", "mobile": "11988887777" },
  "Product": { "product_id": "kiwify-product-1" },
  "Commissions": { "charge_amount": "97.00", "currency_type": "BRL" },
  "TrackingParameters": { "xcod": "click_pix_001" }
}
```

`worker/tests/fixtures/kiwify-refund.json`:
```json
{
  "webhook_event_type": "order_refunded",
  "order_id": "ORD-AAA-001",
  "order_status": "refunded",
  "created_at": "2026-05-04T10:00:00Z",
  "Customer": { "email": "maria@exemplo.com" },
  "Product": { "product_id": "kiwify-product-1" },
  "Commissions": { "charge_amount": "97.00", "currency_type": "BRL" },
  "TrackingParameters": { "xcod": "click_xyz_789" }
}
```

- [ ] **Step 2: Teste**

`worker/tests/kiwify.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseKiwify } from '../src/parsers/kiwify';
import approved from './fixtures/kiwify-order-approved.json';
import pix from './fixtures/kiwify-pix-created.json';
import refund from './fixtures/kiwify-refund.json';

describe('parseKiwify', () => {
  it('order_approved → conversion_type=paid', () => {
    const d = parseKiwify(approved);
    expect(d.conversion_type).toBe('paid');
    expect(d.external_order_id).toBe('ORD-AAA-001');
    expect(d.amount).toBe(97);
    expect(d.currency).toBe('BRL');
    expect(d.click_id_from_payload).toBe('click_xyz_789');
    expect(d.gclid_from_payload).toBe('GCLID_AAA');
    expect(d.customer_email).toBe('maria@exemplo.com'); // normalizado lowercase
    expect(d.offer_external_id).toBe('kiwify-product-1');
  });

  it('pix_created → conversion_type=pix_generated', () => {
    expect(parseKiwify(pix).conversion_type).toBe('pix_generated');
  });

  it('order_refunded → conversion_type=refund', () => {
    expect(parseKiwify(refund).conversion_type).toBe('refund');
  });

  it('preserva raw payload', () => {
    expect(parseKiwify(approved).raw).toEqual(approved);
  });
});
```

- [ ] **Step 3: Implementar `worker/src/parsers/kiwify.ts`**

```ts
import type { ConversionDraft, ConversionType } from '../types';

interface KiwifyPayload {
  webhook_event_type?: string;
  order_id?: string;
  order_status?: string;
  created_at?: string;
  Customer?: { email?: string; mobile?: string; first_name?: string; last_name?: string };
  Product?: { product_id?: string };
  Commissions?: { charge_amount?: string | number; currency_type?: string };
  TrackingParameters?: { xcod?: string; click_id?: string; gclid?: string; [k: string]: unknown };
}

const EVENT_TO_TYPE: Record<string, ConversionType> = {
  order_approved: 'paid',
  order_refunded: 'refund',
  pix_created: 'pix_generated',
  billet_created: 'billet_generated',
  abandoned_cart: 'abandoned',
  order_chargeback: 'chargeback',
};

export function parseKiwify(raw: unknown): ConversionDraft {
  const p = raw as KiwifyPayload;
  const evt = (p.webhook_event_type ?? '').toLowerCase();
  const conversion_type = EVENT_TO_TYPE[evt];
  if (!conversion_type) throw new Error(`Kiwify: evento desconhecido: ${evt}`);

  const amountStr = p.Commissions?.charge_amount ?? '0';
  const amount = typeof amountStr === 'number' ? amountStr : parseFloat(amountStr);

  const tp = p.TrackingParameters ?? {};
  const click_id_from_payload = (tp.xcod ?? tp.click_id) as string | undefined;
  const gclid_from_payload = tp.gclid as string | undefined;

  const email = p.Customer?.email?.trim().toLowerCase();

  return {
    external_order_id: String(p.order_id ?? ''),
    conversion_type,
    amount,
    currency: p.Commissions?.currency_type ?? 'BRL',
    customer_email: email,
    customer_phone: p.Customer?.mobile,
    customer_first_name: p.Customer?.first_name,
    customer_last_name: p.Customer?.last_name,
    click_id_from_payload,
    gclid_from_payload,
    occurred_at: p.created_at ?? new Date().toISOString(),
    offer_external_id: p.Product?.product_id,
    raw,
  };
}
```

- [ ] **Step 4: Rodar — PASS**

- [ ] **Step 5: Commitar**

```bash
git add worker/src/parsers/kiwify.ts worker/tests/fixtures/kiwify-*.json worker/tests/kiwify.test.ts
git commit -m "feat(worker): parser kiwify (paid/pix/billet/refund/abandoned/chargeback)"
```

---

## Task 18: `routes/webhook-kiwify.ts` — HMAC, dedup, match, insert

**Files:**
- Create: `worker/src/routes/webhook-kiwify.ts`
- Create: `worker/src/lib/webhook-secret.ts` (helper compartilhado por kiwify+hotmart)
- Modify: `worker/src/index.ts`
- Create: `worker/tests/webhook-kiwify.test.ts`

- [ ] **Step 1: Helper `worker/src/lib/webhook-secret.ts`**

```ts
import type { Env } from '../types';
import { createSupabaseClient } from './supabase';
import { decryptAesGcm } from './crypto';

export interface ResolvedWebhookSecret {
  workspace_id: string;
  platform: string;
  secret_plaintext: string;
}

export async function resolveWebhookSecret(
  env: Env,
  platform: string,
  endpointToken: string
): Promise<ResolvedWebhookSecret | null> {
  const sb = createSupabaseClient(env);
  const rows = await sb.select<{
    workspace_id: string;
    platform: string;
    secret_encrypted: string;
    secret_iv: string;
  }>('webhook_secrets', {
    endpoint_token: `eq.${endpointToken}`,
    platform: `eq.${platform}`,
    is_active: 'eq.true',
    select: 'workspace_id,platform,secret_encrypted,secret_iv',
    limit: '1',
  });
  if (rows.length === 0) return null;
  const row = rows[0];

  // Bypass de decrypt em dev (placeholders no seed)
  if (env.ENV === 'development') {
    const plain =
      platform === 'kiwify' ? env.DEV_KIWIFY_SECRET :
      platform === 'hotmart' ? env.DEV_HOTMART_SECRET :
      undefined;
    if (!plain) return null;
    return { workspace_id: row.workspace_id, platform, secret_plaintext: plain };
  }

  const plain = await decryptAesGcm(env.ENCRYPTION_KEY, row.secret_encrypted, row.secret_iv);
  return { workspace_id: row.workspace_id, platform, secret_plaintext: plain };
}
```

- [ ] **Step 2: Teste de integração**

`worker/tests/webhook-kiwify.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseClient } from '../src/lib/supabase';
import { hmacSha256Hex } from '../src/lib/crypto';
import approved from './fixtures/kiwify-order-approved.json';

const WS = '00000000-0000-0000-0000-000000000001';
const TOKEN = 'dev_kiwify_token_aaaaaaaaaaaaaaaa';
const sb = createSupabaseClient(env);

beforeEach(async () => {
  await sb.delete('conversions', { workspace_id: `eq.${WS}`, external_order_id: 'like.ORD-AAA-%' });
  await sb.delete('clicks', { workspace_id: `eq.${WS}`, click_id: 'like.click_xyz_%' });
});

async function postWebhook(body: string, signature: string) {
  return SELF.fetch(`http://test/webhook/kiwify/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kiwify-signature': signature },
    body,
  });
}

describe('POST /webhook/kiwify/:token', () => {
  it('rejeita 401 com HMAC inválido', async () => {
    const body = JSON.stringify(approved);
    const res = await postWebhook(body, 'deadbeef');
    expect(res.status).toBe(401);
  });

  it('cria conversion com match_method=click_id quando click existe', async () => {
    await sb.insert('clicks', { click_id: 'click_xyz_789', visitor_id: 'v', workspace_id: WS, landing_url: 'http://lp', gclid: 'GCLID_AAA' });
    const body = JSON.stringify(approved);
    const sig = await hmacSha256Hex(env.DEV_KIWIFY_SECRET!, body);
    const res = await postWebhook(body, sig);
    expect(res.status).toBe(200);

    const rows = await sb.select<any>('conversions', {
      workspace_id: `eq.${WS}`,
      external_order_id: 'eq.ORD-AAA-001',
      select: 'click_id,match_method,amount,currency,conversion_type',
    });
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      click_id: 'click_xyz_789',
      match_method: 'click_id',
      conversion_type: 'paid',
    });
  });

  it('cria conversion com match_method=gclid_in_payload quando só gclid bate', async () => {
    await sb.insert('clicks', { click_id: 'click_other_id', visitor_id: 'v', workspace_id: WS, landing_url: 'http://lp', gclid: 'GCLID_AAA' });
    const payload = { ...approved, TrackingParameters: { gclid: 'GCLID_AAA' } }; // sem xcod
    const body = JSON.stringify(payload);
    const sig = await hmacSha256Hex(env.DEV_KIWIFY_SECRET!, body);
    const res = await postWebhook(body, sig);
    expect(res.status).toBe(200);

    const rows = await sb.select<any>('conversions', { external_order_id: 'eq.ORD-AAA-001', select: 'match_method,click_id' });
    expect(rows[0].match_method).toBe('gclid_in_payload');
    expect(rows[0].click_id).toBe('click_other_id');
  });

  it('é idempotente em (workspace, order, type) — mesmo payload 2x não duplica', async () => {
    const body = JSON.stringify(approved);
    const sig = await hmacSha256Hex(env.DEV_KIWIFY_SECRET!, body);
    const r1 = await postWebhook(body, sig);
    const r2 = await postWebhook(body, sig);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const rows = await sb.select<any>('conversions', { external_order_id: 'eq.ORD-AAA-001', select: 'id' });
    expect(rows.length).toBe(1);
  });

  it('responde 404 com endpoint_token inválido', async () => {
    const body = JSON.stringify(approved);
    const res = await SELF.fetch('http://test/webhook/kiwify/token_inexistente', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kiwify-signature': 'x' },
      body,
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Implementar `worker/src/routes/webhook-kiwify.ts`**

```ts
import type { Env } from '../types';
import { createSupabaseClient } from '../lib/supabase';
import { verifyHmacSha256, hashEmail, hashPhone, sha256Hex } from '../lib/crypto';
import { createDedup } from '../lib/dedup';
import { resolveWebhookSecret } from '../lib/webhook-secret';
import { matchConversion } from '../lib/matching';
import { parseKiwify } from '../parsers/kiwify';

export async function handleWebhookKiwify(req: Request, env: Env, endpointToken: string): Promise<Response> {
  const resolved = await resolveWebhookSecret(env, 'kiwify', endpointToken);
  if (!resolved) return new Response('not found', { status: 404 });

  const rawBody = await req.text();
  const sig = req.headers.get('x-kiwify-signature') ?? '';
  if (!sig) return new Response('missing signature', { status: 401 });
  const ok = await verifyHmacSha256(resolved.secret_plaintext, rawBody, sig);
  if (!ok) return new Response('invalid signature', { status: 401 });

  // dedup
  const dedup = createDedup({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  const dedupKey = `wh:kiwify:${await sha256Hex(resolved.workspace_id + rawBody)}`;
  const isDup = await dedup.checkAndMark(dedupKey, 86400);
  if (isDup) return new Response(null, { status: 200 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const draft = parseKiwify(payload);
  const sb = createSupabaseClient(env);
  const match = await matchConversion(sb, resolved.workspace_id, {
    click_id_from_payload: draft.click_id_from_payload,
    gclid_from_payload: draft.gclid_from_payload,
  });

  // resolver offer_id pelo external_product_id
  let offer_id: string | null = null;
  if (draft.offer_external_id) {
    const offers = await sb.select<{ id: string }>('offers', {
      workspace_id: `eq.${resolved.workspace_id}`,
      external_product_id: `eq.${draft.offer_external_id}`,
      checkout_platform: 'eq.kiwify',
      select: 'id',
      limit: '1',
    });
    offer_id = offers[0]?.id ?? null;
  }

  const row = {
    workspace_id: resolved.workspace_id,
    click_id: match.click_id,
    offer_id,
    external_order_id: draft.external_order_id,
    conversion_type: draft.conversion_type,
    amount: draft.amount,
    currency: draft.currency,
    customer_email_hash: draft.customer_email ? await hashEmail(draft.customer_email) : null,
    customer_phone_hash: draft.customer_phone ? await hashPhone(draft.customer_phone) : null,
    customer_first_name_hash: draft.customer_first_name ? await sha256Hex(draft.customer_first_name.trim().toLowerCase()) : null,
    customer_last_name_hash: draft.customer_last_name ? await sha256Hex(draft.customer_last_name.trim().toLowerCase()) : null,
    match_method: match.match_method,
    raw_payload: draft.raw,
    occurred_at: draft.occurred_at,
  };

  await sb.insert('conversions', row, { onConflict: 'workspace_id,external_order_id,conversion_type' });
  return new Response(null, { status: 200 });
}
```

- [ ] **Step 4: Modificar `worker/src/index.ts` pra rotear**

```ts
import type { Env } from './types';
import { handleHealth } from './routes/health';
import { handleLtScript } from './routes/lt-script';
import { handleTrackClick } from './routes/track-click';
import { handleWebhookKiwify } from './routes/webhook-kiwify';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && url.pathname === '/api/health') return handleHealth();
    if (method === 'GET' && url.pathname === '/lt.js') return handleLtScript();
    if (method === 'POST' && url.pathname === '/track/click') return handleTrackClick(request, env);

    const kiwify = url.pathname.match(/^\/webhook\/kiwify\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && kiwify) return handleWebhookKiwify(request, env, kiwify[1]);

    return new Response('Not Found', { status: 404 });
  },
};
```

- [ ] **Step 5: Rodar — PASS**

```bash
pnpm test webhook-kiwify
```

- [ ] **Step 6: Commitar**

```bash
git add worker/src/routes/webhook-kiwify.ts worker/src/lib/webhook-secret.ts worker/src/index.ts worker/tests/webhook-kiwify.test.ts
git commit -m "feat(worker): webhook kiwify com hmac, dedup e matching"
```

---

## Task 19: `parsers/hotmart.ts` — payload Hotmart → ConversionDraft

**Files:**
- Create: `worker/src/parsers/hotmart.ts`
- Create: `worker/tests/fixtures/hotmart-purchase-approved.json`
- Create: `worker/tests/fixtures/hotmart-purchase-refunded.json`
- Create: `worker/tests/fixtures/hotmart-billet.json`
- Create: `worker/tests/hotmart.test.ts`

- [ ] **Step 1: Fixtures** (Hotmart Webhooks v2)

`worker/tests/fixtures/hotmart-purchase-approved.json`:
```json
{
  "id": "evt-001",
  "event": "PURCHASE_APPROVED",
  "creation_date": 1746271800000,
  "data": {
    "purchase": {
      "transaction": "HP-AAA-001",
      "approved_date": 1746271800000,
      "status": "APPROVED",
      "price": { "value": 97.0, "currency_value": "BRL" },
      "tracking": { "external_code": "click_hot_001", "source": "google" },
      "checkout_country": { "iso": "BR" }
    },
    "buyer": { "email": "Cliente@HOT.com", "name": "Cliente Hot", "checkout_phone": "+5511988887777" },
    "product": { "id": "hotmart-product-1", "name": "Té Drenador" }
  }
}
```

`worker/tests/fixtures/hotmart-purchase-refunded.json`:
```json
{
  "id": "evt-002",
  "event": "PURCHASE_REFUNDED",
  "creation_date": 1746358200000,
  "data": {
    "purchase": {
      "transaction": "HP-AAA-001",
      "status": "REFUNDED",
      "price": { "value": 97.0, "currency_value": "BRL" },
      "tracking": { "external_code": "click_hot_001" }
    },
    "buyer": { "email": "cliente@hot.com" },
    "product": { "id": "hotmart-product-1" }
  }
}
```

`worker/tests/fixtures/hotmart-billet.json`:
```json
{
  "id": "evt-003",
  "event": "PURCHASE_BILLET_PRINTED",
  "creation_date": 1746271800000,
  "data": {
    "purchase": {
      "transaction": "HP-AAA-002",
      "status": "WAITING_PAYMENT",
      "price": { "value": 97.0, "currency_value": "BRL" },
      "tracking": { "external_code": "click_hot_002" }
    },
    "buyer": { "email": "outro@hot.com" },
    "product": { "id": "hotmart-product-1" }
  }
}
```

- [ ] **Step 2: Teste**

`worker/tests/hotmart.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseHotmart } from '../src/parsers/hotmart';
import approved from './fixtures/hotmart-purchase-approved.json';
import refunded from './fixtures/hotmart-purchase-refunded.json';
import billet from './fixtures/hotmart-billet.json';

describe('parseHotmart', () => {
  it('PURCHASE_APPROVED → paid', () => {
    const d = parseHotmart(approved);
    expect(d.conversion_type).toBe('paid');
    expect(d.external_order_id).toBe('HP-AAA-001');
    expect(d.amount).toBe(97);
    expect(d.currency).toBe('BRL');
    expect(d.click_id_from_payload).toBe('click_hot_001');
    expect(d.customer_email).toBe('cliente@hot.com');
    expect(d.offer_external_id).toBe('hotmart-product-1');
  });

  it('PURCHASE_REFUNDED → refund', () => {
    expect(parseHotmart(refunded).conversion_type).toBe('refund');
  });

  it('PURCHASE_BILLET_PRINTED → billet_generated', () => {
    expect(parseHotmart(billet).conversion_type).toBe('billet_generated');
  });
});
```

- [ ] **Step 3: Implementar `worker/src/parsers/hotmart.ts`**

```ts
import type { ConversionDraft, ConversionType } from '../types';

interface HotmartPayload {
  id?: string;
  event?: string;
  creation_date?: number;
  data?: {
    purchase?: {
      transaction?: string;
      approved_date?: number;
      status?: string;
      price?: { value?: number; currency_value?: string };
      tracking?: { external_code?: string; source?: string; src?: string; sck?: string };
    };
    buyer?: { email?: string; name?: string; checkout_phone?: string };
    product?: { id?: string | number; name?: string };
  };
}

const EVENT_TO_TYPE: Record<string, ConversionType> = {
  PURCHASE_APPROVED: 'paid',
  PURCHASE_REFUNDED: 'refund',
  PURCHASE_CHARGEBACK: 'chargeback',
  PURCHASE_BILLET_PRINTED: 'billet_generated',
  PURCHASE_OUT_OF_SHOPPING_CART: 'abandoned',
};

export function parseHotmart(raw: unknown): ConversionDraft {
  const p = raw as HotmartPayload;
  const evt = p.event ?? '';
  const conversion_type = EVENT_TO_TYPE[evt];
  if (!conversion_type) throw new Error(`Hotmart: evento desconhecido: ${evt}`);

  const purchase = p.data?.purchase;
  const buyer = p.data?.buyer;
  const product = p.data?.product;
  const tracking = purchase?.tracking ?? {};

  const occurredMs = purchase?.approved_date ?? p.creation_date ?? Date.now();
  const occurred_at = new Date(occurredMs).toISOString();

  // Hotmart usa external_code como o "xcod" da gente
  const click_id_from_payload = tracking.external_code;

  // Hotmart NÃO repassa gclid nativamente. Se quisermos, o lojista coloca em sck/src — manter undefined por ora.
  const gclid_from_payload = undefined;

  const email = buyer?.email?.trim().toLowerCase();

  return {
    external_order_id: String(purchase?.transaction ?? ''),
    conversion_type,
    amount: purchase?.price?.value ?? 0,
    currency: purchase?.price?.currency_value ?? 'BRL',
    customer_email: email,
    customer_phone: buyer?.checkout_phone,
    customer_first_name: buyer?.name?.split(/\s+/)[0],
    customer_last_name: buyer?.name?.split(/\s+/).slice(1).join(' ') || undefined,
    click_id_from_payload,
    gclid_from_payload,
    occurred_at,
    offer_external_id: product?.id !== undefined ? String(product.id) : undefined,
    raw,
  };
}
```

- [ ] **Step 4: Rodar — PASS**

- [ ] **Step 5: Commitar**

```bash
git add worker/src/parsers/hotmart.ts worker/tests/fixtures/hotmart-*.json worker/tests/hotmart.test.ts
git commit -m "feat(worker): parser hotmart (paid/refund/chargeback/billet/abandoned)"
```

---

## Task 20: `routes/webhook-hotmart.ts` — Hottok, dedup, match, insert

**Files:**
- Create: `worker/src/routes/webhook-hotmart.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/webhook-hotmart.test.ts`

> Hotmart valida via header `X-Hotmart-Hottok` que é o token shared (não HMAC). Comparamos diretamente com o secret armazenado.

- [ ] **Step 1: Teste**

`worker/tests/webhook-hotmart.test.ts`:
```ts
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { createSupabaseClient } from '../src/lib/supabase';
import approved from './fixtures/hotmart-purchase-approved.json';

const WS = '00000000-0000-0000-0000-000000000001';
const TOKEN = 'dev_hotmart_token_bbbbbbbbbbbbbbbb';
const sb = createSupabaseClient(env);

beforeEach(async () => {
  await sb.delete('conversions', { workspace_id: `eq.${WS}`, external_order_id: 'like.HP-AAA-%' });
  await sb.delete('clicks', { workspace_id: `eq.${WS}`, click_id: 'like.click_hot_%' });
});

async function postWebhook(body: string, hottok: string) {
  return SELF.fetch(`http://test/webhook/hotmart/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hotmart-hottok': hottok },
    body,
  });
}

describe('POST /webhook/hotmart/:token', () => {
  it('rejeita 401 com Hottok inválido', async () => {
    const res = await postWebhook(JSON.stringify(approved), 'errado');
    expect(res.status).toBe(401);
  });

  it('cria conversion com match_method=click_id', async () => {
    await sb.insert('clicks', { click_id: 'click_hot_001', visitor_id: 'v', workspace_id: WS, landing_url: 'http://lp' });
    const res = await postWebhook(JSON.stringify(approved), env.DEV_HOTMART_SECRET!);
    expect(res.status).toBe(200);
    const rows = await sb.select<any>('conversions', {
      external_order_id: 'eq.HP-AAA-001',
      select: 'click_id,match_method,conversion_type',
    });
    expect(rows[0]).toMatchObject({
      click_id: 'click_hot_001',
      match_method: 'click_id',
      conversion_type: 'paid',
    });
  });

  it('idempotente em duplicata', async () => {
    const r1 = await postWebhook(JSON.stringify(approved), env.DEV_HOTMART_SECRET!);
    const r2 = await postWebhook(JSON.stringify(approved), env.DEV_HOTMART_SECRET!);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const rows = await sb.select<any>('conversions', { external_order_id: 'eq.HP-AAA-001', select: 'id' });
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Step 2: Implementar `worker/src/routes/webhook-hotmart.ts`**

```ts
import type { Env } from '../types';
import { createSupabaseClient } from '../lib/supabase';
import { sha256Hex, hashEmail, hashPhone } from '../lib/crypto';
import { createDedup } from '../lib/dedup';
import { resolveWebhookSecret } from '../lib/webhook-secret';
import { matchConversion } from '../lib/matching';
import { parseHotmart } from '../parsers/hotmart';

export async function handleWebhookHotmart(req: Request, env: Env, endpointToken: string): Promise<Response> {
  const resolved = await resolveWebhookSecret(env, 'hotmart', endpointToken);
  if (!resolved) return new Response('not found', { status: 404 });

  const hottok = req.headers.get('x-hotmart-hottok') ?? '';
  if (hottok !== resolved.secret_plaintext) return new Response('invalid signature', { status: 401 });

  const rawBody = await req.text();

  const dedup = createDedup({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  const dedupKey = `wh:hotmart:${await sha256Hex(resolved.workspace_id + rawBody)}`;
  if (await dedup.checkAndMark(dedupKey, 86400)) return new Response(null, { status: 200 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const draft = parseHotmart(payload);
  const sb = createSupabaseClient(env);
  const match = await matchConversion(sb, resolved.workspace_id, {
    click_id_from_payload: draft.click_id_from_payload,
    gclid_from_payload: draft.gclid_from_payload,
  });

  let offer_id: string | null = null;
  if (draft.offer_external_id) {
    const offers = await sb.select<{ id: string }>('offers', {
      workspace_id: `eq.${resolved.workspace_id}`,
      external_product_id: `eq.${draft.offer_external_id}`,
      checkout_platform: 'eq.hotmart',
      select: 'id',
      limit: '1',
    });
    offer_id = offers[0]?.id ?? null;
  }

  const row = {
    workspace_id: resolved.workspace_id,
    click_id: match.click_id,
    offer_id,
    external_order_id: draft.external_order_id,
    conversion_type: draft.conversion_type,
    amount: draft.amount,
    currency: draft.currency,
    customer_email_hash: draft.customer_email ? await hashEmail(draft.customer_email) : null,
    customer_phone_hash: draft.customer_phone ? await hashPhone(draft.customer_phone) : null,
    customer_first_name_hash: draft.customer_first_name ? await sha256Hex(draft.customer_first_name.trim().toLowerCase()) : null,
    customer_last_name_hash: draft.customer_last_name ? await sha256Hex(draft.customer_last_name.trim().toLowerCase()) : null,
    match_method: match.match_method,
    raw_payload: draft.raw,
    occurred_at: draft.occurred_at,
  };

  await sb.insert('conversions', row, { onConflict: 'workspace_id,external_order_id,conversion_type' });
  return new Response(null, { status: 200 });
}
```

- [ ] **Step 3: Modificar `worker/src/index.ts`**

```ts
import type { Env } from './types';
import { handleHealth } from './routes/health';
import { handleLtScript } from './routes/lt-script';
import { handleTrackClick } from './routes/track-click';
import { handleWebhookKiwify } from './routes/webhook-kiwify';
import { handleWebhookHotmart } from './routes/webhook-hotmart';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && url.pathname === '/api/health') return handleHealth();
    if (method === 'GET' && url.pathname === '/lt.js') return handleLtScript();
    if (method === 'POST' && url.pathname === '/track/click') return handleTrackClick(request, env);

    const kiwify = url.pathname.match(/^\/webhook\/kiwify\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && kiwify) return handleWebhookKiwify(request, env, kiwify[1]);

    const hotmart = url.pathname.match(/^\/webhook\/hotmart\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && hotmart) return handleWebhookHotmart(request, env, hotmart[1]);

    return new Response('Not Found', { status: 404 });
  },
};
```

- [ ] **Step 4: Rodar — PASS**

```bash
pnpm test webhook-hotmart
```

- [ ] **Step 5: Rodar suite completa do worker**

```bash
pnpm test
```
Esperado: todos os testes passam.

- [ ] **Step 6: Commitar**

```bash
git add worker/src/routes/webhook-hotmart.ts worker/src/index.ts worker/tests/webhook-hotmart.test.ts
git commit -m "feat(worker): webhook hotmart com hottok, dedup e matching"
```

---

## Task 21: Frontend scaffold — Next.js 15 + Tailwind + shadcn

**Files:**
- Create: `app/` (via create-next-app)
- Modify: `app/.env.local.example`

- [ ] **Step 1: Criar app**

```bash
cd ../   # voltar pra raiz do monorepo
pnpm create next-app@latest app --typescript --tailwind --app --eslint --src-dir false --import-alias "@/*" --no-turbopack
```
Aceitar defaults restantes. Esperado: pasta `app/` criada com Next 15.

- [ ] **Step 2: Configurar pnpm workspace pra reconhecer o app**

`pnpm-workspace.yaml` já lista `app`; reinstalar pra linkar:

```bash
pnpm install
```

- [ ] **Step 3: Instalar dependências do Supabase + shadcn**

```bash
pnpm --filter ./app add @supabase/supabase-js @supabase/ssr
pnpm --filter ./app add -D @types/node
pnpm --filter ./app dlx shadcn@latest init -d
```
No init do shadcn aceitar defaults: New York style, Zinc, CSS variables, app dir.

- [ ] **Step 4: Criar `app/.env.local.example`**

```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key_from_supabase_status>
```

- [ ] **Step 5: Criar `app/.env.local`** (gitignored)

Copiar do `.example` e preencher com `anon key` real obtido via `supabase status`.

- [ ] **Step 6: Adicionar componentes shadcn que vamos usar**

```bash
cd app
pnpm dlx shadcn@latest add button input table card label
cd ..
```

- [ ] **Step 7: Verificar dev server**

```bash
pnpm app:dev
# em outro terminal:
curl -s http://localhost:3000 | head -c 200
```
Esperado: HTML do Next.js. Parar (Ctrl+C).

- [ ] **Step 8: Commitar**

```bash
git add app/ pnpm-workspace.yaml
git commit -m "chore(app): scaffold next.js 15 + tailwind + shadcn"
```

---

## Task 22: Supabase SSR — clientes browser/server/middleware

**Files:**
- Create: `app/lib/supabase/client.ts`
- Create: `app/lib/supabase/server.ts`
- Create: `app/lib/supabase/middleware.ts`
- Create: `app/middleware.ts`

- [ ] **Step 1: `app/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 2: `app/lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // chamado de Server Component — ok ignorar (middleware refresca)
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: `app/lib/supabase/middleware.ts`**

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}
```

- [ ] **Step 4: `app/middleware.ts`**

```ts
import { type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

- [ ] **Step 5: Commitar**

```bash
git add app/lib/supabase/ app/middleware.ts
git commit -m "feat(app): supabase ssr com clients browser/server/middleware"
```

---

## Task 23: Gerar tipos TS do schema

**Files:**
- Create: `app/lib/types/database.ts`

- [ ] **Step 1: Gerar via CLI**

```bash
pnpm db:types
```
Esperado: arquivo `app/lib/types/database.ts` populado com `Database` interface refletindo as 13 tabelas.

- [ ] **Step 2: Confirmar conteúdo**

```bash
head -50 app/lib/types/database.ts
```
Deve conter `export interface Database` e tipos de tabelas como `clicks`, `conversions`, etc.

- [ ] **Step 3: Tipar os clients**

Modificar `app/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/database';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

Modificar `app/lib/supabase/server.ts` similarmente — adicionar `import type { Database } from '@/lib/types/database';` e `createServerClient<Database>(...)`.

- [ ] **Step 4: Commitar**

```bash
git add app/lib/types/database.ts app/lib/supabase/
git commit -m "feat(app): gerar tipos do schema e tipar clients supabase"
```

---

## Task 24: Página `/login` com magic link

**Files:**
- Create: `app/app/login/page.tsx`

- [ ] **Step 1: Criar página**

`app/app/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Entrar no LeoTracker</CardTitle>
        </CardHeader>
        <CardContent>
          {status === 'sent' ? (
            <p className="text-sm">Link mágico enviado pra <strong>{email}</strong>. Cheque sua caixa de entrada.</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                />
              </div>
              <Button type="submit" className="w-full" disabled={status === 'sending'}>
                {status === 'sending' ? 'Enviando...' : 'Enviar link mágico'}
              </Button>
              {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verificar manualmente**

```bash
pnpm app:dev
```
Abrir http://localhost:3000/login. Submeter email do user de teste (`dev@finaltrack.local`). Em local, o magic link aparece no Inbucket (http://localhost:54324). Clicar nele e confirmar redirect.

- [ ] **Step 3: Commitar**

```bash
git add app/app/login/
git commit -m "feat(app): pagina /login com magic link"
```

---

## Task 25: Layout do dashboard com auth guard + página index placeholder

**Files:**
- Create: `app/app/(dashboard)/layout.tsx`
- Create: `app/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Layout com guard**

`app/app/(dashboard)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold">LeoTracker</Link>
          <nav className="text-sm flex gap-4">
            <Link href="/dashboard">Resumo</Link>
            <Link href="/dashboard/conversions">Conversões</Link>
          </nav>
        </div>
        <span className="text-xs text-muted-foreground">{user.email}</span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Página placeholder**

`app/app/(dashboard)/dashboard/page.tsx`:

```tsx
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Resumo</h1>
      <p className="text-sm text-muted-foreground">
        Métricas agregadas (spend, revenue, ROAS) chegam na Fase 2 com a integração Google Ads.
      </p>
      <Card>
        <CardHeader><CardTitle>Conversões</CardTitle></CardHeader>
        <CardContent>
          <Link href="/dashboard/conversions" className="text-primary underline">
            Ver lista de conversões →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verificar manualmente**

Acessar http://localhost:3000/dashboard sem login → redireciona pra `/login`. Logar → cai no dashboard.

- [ ] **Step 4: Commitar**

```bash
git add "app/app/(dashboard)/"
git commit -m "feat(app): layout dashboard com auth guard + index placeholder"
```

---

## Task 26: Página `/dashboard/conversions` — tabela SSR

**Files:**
- Create: `app/components/conversions-table.tsx`
- Create: `app/app/(dashboard)/dashboard/conversions/page.tsx`

- [ ] **Step 1: Componente da tabela**

`app/components/conversions-table.tsx`:

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface ConversionRow {
  id: string;
  occurred_at: string;
  conversion_type: string;
  amount: number;
  currency: string;
  match_method: string | null;
  click_id: string | null;
  external_order_id: string;
  offers: { name: string } | null;
}

function fmtMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function shortId(id: string | null) {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function ConversionsTable({ rows }: { rows: ConversionRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma conversão ainda.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Oferta</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead>Match</TableHead>
          <TableHead>Click ID</TableHead>
          <TableHead>Pedido</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{fmtDate(r.occurred_at)}</TableCell>
            <TableCell>{r.offers?.name ?? '—'}</TableCell>
            <TableCell>{r.conversion_type}</TableCell>
            <TableCell className="text-right">{fmtMoney(Number(r.amount), r.currency)}</TableCell>
            <TableCell>{r.match_method ?? '—'}</TableCell>
            <TableCell><code className="text-xs">{shortId(r.click_id)}</code></TableCell>
            <TableCell><code className="text-xs">{r.external_order_id}</code></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Página**

`app/app/(dashboard)/dashboard/conversions/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';
import { ConversionsTable, type ConversionRow } from '@/components/conversions-table';

export const revalidate = 30;

export default async function ConversionsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('conversions')
    .select('id, occurred_at, conversion_type, amount, currency, match_method, click_id, external_order_id, offers(name)')
    .order('occurred_at', { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Conversões</h1>
        <p className="text-sm text-red-500">Erro ao carregar: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Conversões</h1>
      <ConversionsTable rows={(data ?? []) as unknown as ConversionRow[]} />
    </div>
  );
}
```

- [ ] **Step 3: Verificar manualmente**

```bash
pnpm app:dev
```
Logar, acessar `/dashboard/conversions`. Esperado: tabela vazia ou com qualquer linha que tenha sobrado dos testes do worker.

Pra ver dados reais: rodar um teste de webhook manual com curl (ver Task 27).

- [ ] **Step 4: Commitar**

```bash
git add app/components/conversions-table.tsx "app/app/(dashboard)/dashboard/conversions/"
git commit -m "feat(app): pagina /dashboard/conversions com tabela ssr"
```

---

## Task 27: Smoke test E2E manual + checklist final

**Files:**
- Create: `docs/specs/phase-1-smoke-test.md` (checklist navegável)

> Esta tarefa NÃO tem código — é um roteiro manual pra validar que toda a Fase 1 funciona ponta-a-ponta. Marca cada checkbox conforme vai testando. Se algo falhar, abrir issue/diagnóstico antes de fechar a fase.

- [ ] **Step 1: Garantir tudo rodando local**

```bash
# terminal 1: supabase
supabase start

# terminal 2: worker
pnpm worker:dev

# terminal 3: app
pnpm app:dev
```

- [ ] **Step 2: Criar página de teste pra carregar `/lt.js`**

Criar arquivo temporário `/tmp/lp.html` (ou `C:\Users\lenzi\AppData\Local\Temp\lp.html` no Windows):

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

Servir localmente:
```bash
# em outro terminal
npx http-server /tmp -p 4000 --cors
```

- [ ] **Step 3: Click capture funcional**

Abrir `http://localhost:4000/lp.html?gclid=SMOKE_GCLID&utm_source=google&utm_campaign=Smoke|111&utm_content=Adset|222&utm_term=Ad|333` no navegador.

No DevTools → Application → Cookies, conferir:
- [ ] `_lt_visitor` presente
- [ ] `_lt_click` presente

No DevTools → Elements, inspecionar o link `#cta`:
- [ ] href agora contém `?xcod=<uuid>`

No Supabase Studio → tabela `clicks`:
- [ ] Linha nova com `gclid='SMOKE_GCLID'`, UTMs parsed (`campaign_name_parsed='Smoke'`, `campaign_id_parsed='111'`, etc.)

- [ ] **Step 4: Bot filter funcional**

```bash
curl -i -X POST http://localhost:8787/track/click \
  -H 'content-type: application/json' \
  -H 'user-agent: Googlebot/2.1' \
  -d '{"workspace_id":"00000000-0000-0000-0000-000000000001","click_id":"smoke_bot","visitor_id":"v","landing_url":"http://lp"}'
```
- [ ] Resposta `204`
- [ ] Studio: nenhuma linha nova com `click_id='smoke_bot'`

- [ ] **Step 5: Webhook Kiwify com match_method=click_id**

Pegar o `click_id` injetado em `?xcod=` (do Step 3). Substituir `<XCOD>` no payload abaixo:

```bash
BODY='{"webhook_event_type":"order_approved","order_id":"SMOKE-K-1","order_status":"paid","created_at":"2026-05-03T13:00:00Z","Customer":{"email":"smoke@kiwify.com","mobile":"+5511900000000"},"Product":{"product_id":"kiwify-product-1"},"Commissions":{"charge_amount":"97.00","currency_type":"BRL"},"TrackingParameters":{"xcod":"<XCOD>","gclid":"SMOKE_GCLID"}}'

SIG=$(node -e "const c=require('crypto');const k='kiwify_test_secret_123';const b=process.argv[1];console.log(c.createHmac('sha256',k).update(b).digest('hex'))" "$BODY")

curl -i -X POST "http://localhost:8787/webhook/kiwify/dev_kiwify_token_aaaaaaaaaaaaaaaa" \
  -H 'content-type: application/json' \
  -H "x-kiwify-signature: $SIG" \
  -d "$BODY"
```
- [ ] Resposta `200`
- [ ] Studio: `conversions` tem linha com `match_method='click_id'`, `click_id` igual ao xcod, `amount=97`

- [ ] **Step 6: Webhook Kiwify com HMAC inválido**

```bash
curl -i -X POST "http://localhost:8787/webhook/kiwify/dev_kiwify_token_aaaaaaaaaaaaaaaa" \
  -H 'content-type: application/json' \
  -H 'x-kiwify-signature: deadbeef' \
  -d "$BODY"
```
- [ ] Resposta `401`

- [ ] **Step 7: Webhook duplicado não duplica**

Repetir o curl do Step 5 (mesmo body, mesma assinatura). Conferir que ainda há **1 linha** em `conversions` com `external_order_id='SMOKE-K-1'`.

- [ ] **Step 8: Webhook Kiwify com match_method=gclid_in_payload**

Limpar `xcod` do payload (deixa só gclid):
```bash
BODY='{"webhook_event_type":"order_approved","order_id":"SMOKE-K-2","order_status":"paid","created_at":"2026-05-03T13:05:00Z","Customer":{"email":"x@k.com"},"Product":{"product_id":"kiwify-product-1"},"Commissions":{"charge_amount":"97.00","currency_type":"BRL"},"TrackingParameters":{"gclid":"SMOKE_GCLID"}}'
SIG=$(node -e "const c=require('crypto');console.log(c.createHmac('sha256','kiwify_test_secret_123').update(process.argv[1]).digest('hex'))" "$BODY")
curl -i -X POST "http://localhost:8787/webhook/kiwify/dev_kiwify_token_aaaaaaaaaaaaaaaa" -H 'content-type: application/json' -H "x-kiwify-signature: $SIG" -d "$BODY"
```
- [ ] Studio: nova conversion com `match_method='gclid_in_payload'`, `click_id` apontando pro mesmo click do Step 3

- [ ] **Step 9: Webhook Hotmart com match**

Pega outro click clicando em `?gclid=SMOKE2` na LP. Pega o `xcod` do link Hotmart agora.

```bash
BODY='{"id":"smoke-h-1","event":"PURCHASE_APPROVED","creation_date":1746271800000,"data":{"purchase":{"transaction":"SMOKE-H-1","approved_date":1746271800000,"status":"APPROVED","price":{"value":97.0,"currency_value":"BRL"},"tracking":{"external_code":"<XCOD_HOT>"}},"buyer":{"email":"smoke@hot.com"},"product":{"id":"hotmart-product-1"}}}'
curl -i -X POST "http://localhost:8787/webhook/hotmart/dev_hotmart_token_bbbbbbbbbbbbbbbb" \
  -H 'content-type: application/json' \
  -H 'x-hotmart-hottok: hotmart_test_hottok_456' \
  -d "$BODY"
```
- [ ] Resposta `200`, `conversions` tem linha com `match_method='click_id'`

- [ ] **Step 10: Login + dashboard listando conversões**

- [ ] Acessar http://localhost:3000/dashboard sem login → redireciona /login
- [ ] Logar com `dev@finaltrack.local` (link mágico via Inbucket http://localhost:54324)
- [ ] Após login, acessar `/dashboard/conversions` — vê as 3 conversões criadas (SMOKE-K-1, SMOKE-K-2, SMOKE-H-1) com tipos e match_methods corretos
- [ ] Recarregar — dados persistem

- [ ] **Step 11: RLS bloqueia outro user**

No Studio criar outro user (`outro@local`) sem workspace. Logar com ele em outra sessão (incógnito). Acessar `/dashboard/conversions` — esperado: tabela vazia ou erro de RLS (não vê dados do `dev@`).

- [ ] **Step 12: Salvar checklist no spec**

Copiar este step-12 e marcar tudo verde no `docs/specs/phase-1-smoke-test.md` (criar arquivo novo) pra registrar o estado de pronto. Commitar:

```bash
git add docs/specs/phase-1-smoke-test.md
git commit -m "docs: smoke test fase 1 aprovado"
```

---

## Self-review (executada antes de salvar)

**Cobertura do spec:**
- §2 Componentes alto-nível → Tasks 14-20 (worker), 21-26 (app). ✓
- §3 Estrutura de pastas → seguida exatamente. ✓
- §4 Decisões 1-22 → todas refletidas em alguma task (1: Task 1; 2: Task 23; 3-4: Task 5; 5: Task 14; 6: Task 3; 7: Task 14 + parsers; 8: deferida; 9: Task 8; 10: Task 9; 11: Task 12 + 18/20; 12: Task 4; 13: Task 5; 14: Task 26 (revalidate); 15: Task 4; 16: deploy fora deste plano; 17: deploy fora deste plano; 18: Task 6; 19: Task 10; 20: Task 25-26; 21: Task 13; 22: Task 8 + 16). ✓
- §5 Migration 002 → Task 3. ✓
- §6 Fluxo click capture → Task 14 + 16. ✓
- §7 Fluxo webhook → Tasks 17-20. ✓
- §8 Frontend mínimo → Tasks 21-26. ✓
- §9 Env vars → Task 5 (worker), Task 21 (app). ✓
- §10 Critérios de aceite → Task 27 cobre todos. ✓

**Placeholder scan:** sem TBD/TODO. Todos os steps de código têm código completo. Nenhum "similar to Task N" — código repetido onde precisa.

**Type consistency:** `MatchResult.click_id: string | null`, `MatchResult.match_method: MatchMethod`, `ConversionDraft` campos consistentes entre `parseKiwify`, `parseHotmart` e handlers. `SupabaseClient.insert` aceita `onConflict` em ambos handlers. Tudo bate.

**Sem requisitos do spec sem task:** verificado.
