import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { handleOAuthStart } from '../../src/routes/oauth-google-ads';

describe('GET /oauth/google-ads/start', () => {
  it('400 quando workspace_id ausente', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/start');
    const res = await handleOAuthStart(req, env);
    expect(res.status).toBe(400);
  });

  it('302 + Set-Cookie + Location pra Google quando workspace_id válido', async () => {
    const req = new Request('https://w.dev/oauth/google-ads/start?workspace_id=00000000-0000-0000-0000-000000000001');
    const res = await handleOAuthStart(req, env);
    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain('lt_oauth_state=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=600');
    expect(setCookie).toContain('Path=/oauth/google-ads');
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('access_type=offline');
    expect(location).toContain('prompt=consent');
  });
});
