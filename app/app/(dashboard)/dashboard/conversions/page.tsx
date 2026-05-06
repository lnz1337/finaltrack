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
