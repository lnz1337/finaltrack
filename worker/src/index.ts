import type { Env } from './types';
import { handleHealth } from './routes/health';
import { handleLtScript } from './routes/lt-script';
import { handleTrackClick } from './routes/track-click';
import { handleWebhookKiwify } from './routes/webhook-kiwify';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && url.pathname === '/api/health') return handleHealth();
    if (method === 'GET' && url.pathname === '/lt.js') return handleLtScript();
    if (method === 'POST' && url.pathname === '/track/click') return handleTrackClick(request, env);

    const kiwify = url.pathname.match(/^\/webhook\/kiwify\/([A-Za-z0-9_-]+)$/);
    if (method === 'POST' && kiwify) return handleWebhookKiwify(request, env, kiwify[1]);

    return new Response('Not Found', { status: 404 });
  },
};
