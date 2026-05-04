import type { Env } from './types';
import { handleHealth } from './routes/health';

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;

    if (method === 'GET' && url.pathname === '/api/health') {
      return handleHealth();
    }

    return new Response('Not Found', { status: 404 });
  },
};
