import { createClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return Response.json({ error: 'no_session' }, { status: 401 });

  const body = await req.json().catch(() => null) as { session_uuid?: string; customer_ids?: string[] } | null;
  if (!body?.session_uuid || !Array.isArray(body.customer_ids)) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const workerBase = process.env.WORKER_BASE_URL ?? 'http://localhost:8787';
  const res = await fetch(`${workerBase}/oauth/google-ads/finalize`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${process.env.WORKER_INTERNAL_TOKEN ?? ''}`,
      'X-User-JWT': session.access_token,
    },
    body: JSON.stringify(body),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}
