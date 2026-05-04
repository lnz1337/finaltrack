# FinalTrack (LeoTracker)

Ad tracker próprio focado em Google Ads (Search, Demand Gen, YouTube, PMax, Display) com server-side click capture, webhook correlation e Enhanced Conversions upload via Google Ads API.

## Dev setup

### Pré-requisitos

- Node.js 20+
- pnpm 9+
- Wrangler (`pnpm install -g wrangler`)
- Supabase CLI (`pnpm install -g supabase`)
- Docker Desktop (necessário para `supabase start`)

### Inicializar ambiente local

```bash
# 1. Subir Supabase local (Postgres + Auth + Studio)
pnpm db:start

# 2. Aplicar migrations + criar user de dev + inserir fixtures
pnpm dev:reset
```

`pnpm dev:reset` executa `scripts/setup-dev.sh`, que:
1. Roda `supabase db reset` (aplica migrations 001 e 002; sem seed SQL)
2. Cria o user de dev via API admin do GoTrue
3. Insere workspace, offers e webhook_secrets via psql

### Credenciais de dev

| Campo    | Valor                     |
|----------|---------------------------|
| Email    | `dev@finaltrack.local`    |
| Senha    | `devdev123`               |
| Studio   | http://127.0.0.1:54323    |
| API      | http://127.0.0.1:54321    |

### Rodar a aplicação

```bash
# App (Next.js)
pnpm app:dev

# Worker (Cloudflare Worker)
pnpm worker:dev
```

### Outros scripts

```bash
pnpm db:stop       # Para o Supabase local
pnpm db:reset      # Reset das migrations sem fixtures de dev
pnpm db:types      # Gera tipos TypeScript do schema
```
