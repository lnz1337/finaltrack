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
