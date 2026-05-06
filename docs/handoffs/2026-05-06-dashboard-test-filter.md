# Handoff: feat/dashboard-test-filter — 2026-05-06

> Pausa antes da execução. Plano formal apresentado, 3 perguntas
> pendentes pra fechar escopo. Quando retomar, começa lendo este doc.

## Contexto

Após merge da Payt integration (commit `2f89a77` na main, 2026-05-05),
schema de `conversions` ganhou coluna `is_test BOOLEAN NOT NULL DEFAULT false`
(migration `20260505000003_conversions_is_test.sql`). Index parcial em
`(workspace_id, is_test) WHERE is_test = true` já existe.

Frontend ainda NÃO usa o campo. Esta branch fecha esse loop:

- Default da query do dashboard passa a filtrar `is_test = false` (só prod)
- Toggle via URL searchParam `?include_test=1` traz test rows de volta
- Sem state client-side, sem badge contador, sem query extra

## Estado atual

- **Branch ativa:** `feat/payt-integration` (preservada, working tree clean)
- **main:** `1e275cb docs(payt): registra integração Payt + flakiness tech debt`
- **Branches locais preservadas:**
  - `feat/fase-1-click-capture`
  - `feat/payt-integration`
  - `main`
- **156 testes worker passando**
- **DB local:** `supabase_db_FinalTrack` rodando, 3 conversions rows reais

## 3 perguntas pendentes pra fechar escopo

### 1. Posicionamento do Link toggle

- **(i)** No `page.tsx`, ao lado do `<h1>` em flex justify-between.
  ConversionsTable inalterado. **1 arquivo modificado.**
- **(ii)** Dentro de `ConversionsTable`, antes do `<Table>`. Componente
  recebe novo prop `includeTest: boolean`. **2 arquivos modificados.**

**Recomendação registrada:** (i) — separation of concerns. Tabela só
renderiza rows; URL state é page concern.

### 2. `revalidate = 30` no page.tsx

Em Next 16, `searchParams` força dynamic rendering, então `revalidate`
fica inert.

- **(a)** Remover a linha pra evitar dead config
- **(b)** Deixar pra evitar diff de escopo

**Recomendação registrada:** (a) remover, é trivial e a próxima pessoa
não vai se perguntar por que tá lá.

### 3. Aprovação da sequência de execução

(Plano completo abaixo — só falta tu aprovar literal ou ajustar.)

## Plano completo (já apresentado, aguardando aprovação)

### Escopo

1 commit, branch from main, merge `--no-ff` na main. Estimativa 25min.

### Arquivos

- `app/app/(dashboard)/dashboard/conversions/page.tsx` — modificado
- (se decisão #1 = ii: `app/components/conversions-table.tsx` também)

### Mudanças no page.tsx (assumindo decisão (i) + (a))

```typescript
import { createClient } from '@/lib/supabase/server';
import { ConversionsTable, type ConversionRow } from '@/components/conversions-table';
import Link from 'next/link';

export default async function ConversionsPage({
  searchParams,
}: {
  searchParams: Promise<{ include_test?: string }>;
}) {
  const params = await searchParams;
  const includeTest = params.include_test === '1';

  const supabase = await createClient();
  let query = supabase
    .from('conversions')
    .select('id, occurred_at, conversion_type, amount, currency, match_method, click_id, external_order_id, offers(name)')
    .order('occurred_at', { ascending: false })
    .limit(200);

  if (!includeTest) query = query.eq('is_test', false);
  const { data, error } = await query;

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
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Conversões</h1>
        <Link
          href={includeTest ? '/dashboard/conversions' : '/dashboard/conversions?include_test=1'}
          className="text-sm text-muted-foreground hover:underline"
        >
          {includeTest ? 'ocultar testes' : 'incluir testes'}
        </Link>
      </div>
      <ConversionsTable rows={(data ?? []) as unknown as ConversionRow[]} />
    </div>
  );
}
```

### Pre-execution

Per `app/AGENTS.md`: ler `node_modules/next/dist/docs/` antes de escrever
código pra confirmar API atual de searchParams (Promise) + Link em
Server Component no Next 16.

### Validação

**SQL (worker/Claude executa):**

```sql
INSERT INTO conversions (workspace_id, external_order_id, conversion_type, amount, currency, match_method, occurred_at, raw_payload, is_test)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'SMOKE-FILTER-TEST',
  'paid',
  1, 'BRL',
  'unmatched',
  NOW(),
  '{}',
  true
);

-- Validar:
SELECT COUNT(*) FROM conversions WHERE is_test = false;  -- esperado: 3
SELECT COUNT(*) FROM conversions;                        -- esperado: 4

-- Cleanup:
DELETE FROM conversions WHERE external_order_id = 'SMOKE-FILTER-TEST';
```

**Manual no browser (Leo executa):**

- `/dashboard/conversions` → só prod rows (3 rows do estado pré-smoke)
  + Link "incluir testes"
- `/dashboard/conversions?include_test=1` → ambas (4 rows com a do smoke)
  + Link "ocultar testes"
- Click no toggle → URL muda, table re-renderiza

**Type check:** `pnpm --filter ./app build` antes do commit.

**Worker:** `pnpm test` (regressão zero esperada — não toca worker).

### Commit message

```
feat(app): filtro is_test no dashboard de conversões

Default da query filtra is_test=false (só prod). Toggle via URL
searchParam ?include_test=1 traz test rows de volta (sem state
client-side, sem badge, sem query extra).

- page.tsx: searchParams (Promise async no Next 16) → query condicional
- Link "incluir testes" / "ocultar testes" condicional no header
- ConversionsTable inalterado (recebe rows já filtradas)
- revalidate=30 removido (searchParams força dynamic em Next 16,
  revalidate ficava inert)

Fecha followup do schema is_test introduzido na Payt integration
(commit 0c27d86). Index parcial (workspace_id, is_test) WHERE
is_test=true otimiza ON path do toggle em volume.
```

### Sequência de execução

1. `git checkout main && git pull origin main`
2. `git checkout -b feat/dashboard-test-filter`
3. Ler docs Next 16 (searchParams + Link)
4. Edit page.tsx
5. `pnpm --filter ./app build` — type/build check
6. SQL smoke (insert + selects)
7. Pausa pra Leo validar visual no browser
8. SQL cleanup (DELETE smoke row)
9. `git add` explícito + commit
10. `pnpm test` worker (regressão zero esperada)
11. Após aprovação: merge `--no-ff` na main + push + checkout volta pra branch

## Próxima sessão — primeiro prompt

> "Retomar dashboard-test-filter. Lê `docs/handoffs/2026-05-06-dashboard-test-filter.md`
> e respondo as 3 perguntas: 1=(i), 2=(a), 3=aprovado. Procede sequência."

(Ou Leo ajusta as 3 respostas conforme preferir.)
