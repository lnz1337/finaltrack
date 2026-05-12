import { createClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return Response.json({ error: 'no_session' }, { status: 401 });

  const body = await req.json().catch(() => null) as { google_ads_account_id?: string } | null;
  if (!body?.google_ads_account_id) return Response.json({ error: 'missing_account_id' }, { status: 400 });

  const { data: workspaces } = await supabase.from('workspaces').select('id').eq('owner_id', user.id);
  const workspaceIds = (workspaces ?? []).map((w) => w.id);
  const { data: account } = await supabase
    .from('google_ads_accounts')
    .select('id, workspace_id')
    .eq('id', body.google_ads_account_id)
    .maybeSingle();
  if (!account || !workspaceIds.includes(account.workspace_id)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const workerBase = process.env.WORKER_BASE_URL ?? 'http://localhost:8787';
  const workerToken = process.env.WORKER_INTERNAL_TOKEN ?? '';
  const res = await fetch(`${workerBase}/api/google-ads/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${workerToken}`,
      'X-User-JWT': session.access_token,
    },
    body: JSON.stringify({ google_ads_account_id: body.google_ads_account_id }),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}
