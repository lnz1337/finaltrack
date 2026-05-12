import { type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get('account_id');
  if (!accountId) return Response.json({ error: 'missing account_id' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { data: row } = await supabase
    .from('google_ads_sync_log')
    .select('id, status, started_at, completed_at, rows_synced, parsed_skipped, partial_skipped, error_message')
    .eq('google_ads_account_id', accountId)
    .eq('sync_type', 'metadata')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return Response.json({ row: row ?? null });
}
