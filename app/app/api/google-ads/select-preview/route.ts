import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');
  if (!sessionId) return Response.json({ error: 'missing_session_id' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return Response.json({ error: 'no_session' }, { status: 401 });

  const workerBase = process.env.WORKER_BASE_URL ?? 'http://localhost:8787';
  const res = await fetch(`${workerBase}/oauth/google-ads/session/${sessionId}/preview`, {
    headers: {
      Authorization: `Bearer ${process.env.WORKER_INTERNAL_TOKEN ?? ''}`,
      'X-User-JWT': session.access_token,
    },
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}
