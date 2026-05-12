import type { Env } from '../types';
import { validateInternalRequest } from '../lib/internal-auth';
import { createSupabaseClient } from '../lib/supabase';

export async function handleGoogleAdsDisconnect(req: Request, env: Env): Promise<Response> {
  let auth: Awaited<ReturnType<typeof validateInternalRequest>>;
  try {
    auth = await validateInternalRequest(req, env);
  } catch (resp) {
    return resp as Response;
  }

  const body = (await req.json().catch(() => null)) as { google_ads_account_id?: string } | null;
  if (!body?.google_ads_account_id) {
    return new Response(JSON.stringify({ error: 'missing_account_id' }), { status: 400 });
  }

  const sb = createSupabaseClient(env);
  const accs = await sb.select<{ id: string; workspace_id: string }>('google_ads_accounts', {
    id: `eq.${body.google_ads_account_id}`, select: 'id,workspace_id', limit: '1',
  });
  if (!accs[0] || !auth.workspaceIds.includes(accs[0].workspace_id)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  await sb.update('google_ads_accounts', { id: `eq.${accs[0].id}` }, { is_active: false });
  return new Response(JSON.stringify({ is_active: false }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}
