import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildConsentUrl, exchangeCodeForTokens } from '../../src/lib/google-ads/oauth';
import { InvalidGrantError } from '../../src/lib/google-ads/errors';

describe('buildConsentUrl', () => {
  it('contém todos os params obrigatórios', () => {
    const url = buildConsentUrl({
      clientId: 'CLIENT_ID',
      redirectUri: 'http://localhost:8787/oauth/google-ads/callback',
      state: 'state-123',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('client_id')).toBe('CLIENT_ID');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:8787/oauth/google-ads/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adwords');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    expect(parsed.searchParams.get('state')).toBe('state-123');
  });
});

describe('exchangeCodeForTokens', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('retorna tokens em sucesso', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const result = await exchangeCodeForTokens({
      code: 'CODE',
      clientId: 'CID',
      clientSecret: 'CS',
      redirectUri: 'http://r',
    });
    expect(result).toEqual({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
  });

  it('throw InvalidGrantError em 400 invalid_grant', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
    );
    await expect(exchangeCodeForTokens({ code: 'C', clientId: 'CID', clientSecret: 'CS', redirectUri: 'r' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('throw genérico em outros 4xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 })
    );
    await expect(exchangeCodeForTokens({ code: 'C', clientId: 'CID', clientSecret: 'CS', redirectUri: 'r' }))
      .rejects.toThrow();
  });
});
