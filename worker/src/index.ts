import type { Env } from './types';
import { handleHealth } from './routes/health';
import { handleLtScript } from './routes/lt-script';

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && url.pathname === '/api/health') return handleHealth();
    if (method === 'GET' && url.pathname === '/lt.js') return handleLtScript();

    return new Response('Not Found', { status: 404 });
  },
};
