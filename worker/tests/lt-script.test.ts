import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /lt.js', () => {
  it('responde 200 com Content-Type js e Cache-Control 1h', async () => {
    const res = await SELF.fetch('http://test/lt.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
    const body = await res.text();
    expect(body).toContain('__LT_INIT__');
    expect(body).toContain('_lt_visitor');
  });
});
