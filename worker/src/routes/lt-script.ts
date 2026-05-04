import { LT_CLIENT_SOURCE } from '../tracker/lt.client';

export function handleLtScript(): Response {
  return new Response(LT_CLIENT_SOURCE, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
