import type { Env } from './types';
import { handleHealth } from './routes/health';
import { handleLtScript } from './routes/lt-script';
import { handleTrackClick, handleTrackClickOptions } from './routes/track-click';
import { handleWebhookKiwify } from './routes/webhook-kiwify';
import { handleWebhookHotmart } from './routes/webhook-hotmart';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && url.pathname === '/api/health') return handleHealth();
    if (method === 'GET' && url.pathname === '/lt.js') return handleLtScript();
    if (method === 'OPTIONS' && url.pathname === '/track/click') return handleTrackClickOptions(request, env);
    if (method === 'POST' && url.pathname === '/track/click') return handleTrackClick(request, env);

    const kiwify = url.pathname.match(/^\/webhook\/kiwify\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && kiwify) return handleWebhookKiwify(request, env, kiwify[1]);

    const hotmart = url.pathname.match(/^\/webhook\/hotmart\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && hotmart) return handleWebhookHotmart(request, env, hotmart[1]);

    return new Response('Not Found', { status: 404 });
  },
};
