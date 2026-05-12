import type { Env } from './types';
import { handleHealth } from './routes/health';
import { handleLtScript } from './routes/lt-script';
import { handleTrackClick, handleTrackClickOptions } from './routes/track-click';
import { handleWebhookKiwify } from './routes/webhook-kiwify';
import { handleWebhookHotmart } from './routes/webhook-hotmart';
import { handleWebhookPayt } from './routes/webhook-payt';
import {
  handleOAuthStart, handleOAuthCallback, handleOAuthPreview, handleOAuthFinalize,
} from './routes/oauth-google-ads';
import { handleGoogleAdsSync } from './routes/google-ads-sync';
import { handleGoogleAdsDisconnect } from './routes/google-ads-disconnect';
import { createSupabaseClient } from './lib/supabase';
import { syncAccount, type GoogleAdsAccountRow } from './lib/google-ads/sync';
import { createStructuredLogger } from './lib/structured-log';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;
    const path = url.pathname;

    if (method === 'GET' && path === '/api/health') return handleHealth();
    if (method === 'GET' && path === '/lt.js') return handleLtScript();
    if (method === 'OPTIONS' && path === '/track/click') return handleTrackClickOptions(request, env);
    if (method === 'POST' && path === '/track/click') return handleTrackClick(request, env);

    const kiwify = path.match(/^\/webhook\/kiwify\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && kiwify) return handleWebhookKiwify(request, env, kiwify[1]);

    const hotmart = path.match(/^\/webhook\/hotmart\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && hotmart) return handleWebhookHotmart(request, env, hotmart[1]);

    const payt = path.match(/^\/webhook\/payt\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && payt) return handleWebhookPayt(request, env, payt[1]);

    // Google Ads OAuth + API (Fase 2A)
    if (method === 'GET' && path === '/oauth/google-ads/start') return handleOAuthStart(request, env);
    if (method === 'GET' && path === '/oauth/google-ads/callback') return handleOAuthCallback(request, env);
    const previewMatch = path.match(/^\/oauth\/google-ads\/session\/([^/]+)\/preview$/);
    if (method === 'GET' && previewMatch) return handleOAuthPreview(request, env, previewMatch[1]);
    if (method === 'POST' && path === '/oauth/google-ads/finalize') return handleOAuthFinalize(request, env);
    if (method === 'POST' && path === '/api/google-ads/sync') return handleGoogleAdsSync(request, env, ctx);
    if (method === 'POST' && path === '/api/google-ads/disconnect') return handleGoogleAdsDisconnect(request, env);

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const traceId = crypto.randomUUID();
    const startedAt = Date.now();
    const log = createStructuredLogger(traceId, startedAt);
    log.info('cron_started', { cron: event.cron });

    const sb = createSupabaseClient(env);
    const accounts = await sb.select<GoogleAdsAccountRow>('google_ads_accounts', {
      is_active: 'eq.true',
      select: 'id,workspace_id,customer_id,manager_customer_id,refresh_token_encrypted,refresh_token_iv,is_active',
    });
    log.info('cron_accounts_listed', { count: accounts.length });

    // Sequencial pra não estourar rate limit do Google Ads.
    for (const account of accounts) {
      try {
        await syncAccount(env, sb, account.id, 'cron');
        log.info('cron_account_synced', { account_id: account.id });
      } catch (err) {
        log.error('cron_account_failed', {
          account_id: account.id, error: err instanceof Error ? err.message : String(err),
        });
        // Continua próxima account — uma falha não bloqueia as outras.
      }
    }

    // Cleanup oauth_pending_selections expirados (decisão 3.A.2.2 — sem job dedicado).
    try {
      await sb.delete('oauth_pending_selections', { expires_at: `lt.${new Date().toISOString()}` });
      log.info('cron_pending_cleanup_ok');
    } catch (err) {
      log.warn('cron_pending_cleanup_failed', { error: err instanceof Error ? err.message : String(err) });
    }

    log.info('cron_finished', { duration_ms: Date.now() - startedAt });
  },
};
