import type { Env } from '../types';
import { validateInternalRequest } from '../lib/internal-auth';
import { createSupabaseClient } from '../lib/supabase';
import { syncAccount } from '../lib/google-ads/sync';

// NOTA: spec §5 prevê "200 imediato + ctx.waitUntil()". Implementação aqui é síncrona
// (mais simples; latência ~10-20s aceitável pra single-tenant). UI faz polling depois
// (decisão 5.7.2). Refatorar pra split prepareSyncLog()+runSync() + waitUntil quando vol crescer.
// `ctx` mantido na signature pra esse refactor futuro (Task 38 já passa).
export async function handleGoogleAdsSync(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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
  // Ownership check: account precisa pertencer a um workspace do user.
  const accs = await sb.select<{ workspace_id: string }>('google_ads_accounts', {
    id: `eq.${body.google_ads_account_id}`,
    select: 'workspace_id',
    limit: '1',
  });
  if (!accs[0] || !auth.workspaceIds.includes(accs[0].workspace_id)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  try {
    const result = await syncAccount(env, sb, body.google_ads_account_id, 'manual');
    return new Response(JSON.stringify({
      log_id: result.log_id, status: result.status, started_at: new Date().toISOString(),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    if (err instanceof Error && err.message === 'sync_in_progress') {
      return new Response(JSON.stringify({ error: 'sync_in_progress' }), { status: 409 });
    }
    return new Response(JSON.stringify({ error: 'sync_failed', message: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
}
