import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /api/health', () => {
  it('responde 200 com ok=true', async () => {
    const res = await SELF.fetch('http://test/api/health');
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; ts: string }>();
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('string');
  });

  it('responde 404 em rota desconhecida', async () => {
    const res = await SELF.fetch('http://test/no-such-path');
    expect(res.status).toBe(404);
  });
});
