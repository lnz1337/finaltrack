import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshAccessToken } from '../../src/lib/google-ads/client';
import { InvalidGrantError, InvalidClientError, GoogleAdsApiError } from '../../src/lib/google-ads/errors';

describe('refreshAccessToken', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('retorna access_token + expires_in em sucesso', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ access_token: 'AT', expires_in: 3600 }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ));
    const r = await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', clientSecret: 'CS' });
    expect(r).toEqual({ access_token: 'AT', expires_in: 3600 });
  });

  it('throw InvalidGrantError em 400 invalid_grant', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: 'invalid_grant' }),
      { status: 400 }
    ));
    await expect(refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', clientSecret: 'CS' }))
      .rejects.toBeInstanceOf(InvalidGrantError);
  });

  it('throw InvalidClientError em 401 invalid_client', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: 'invalid_client' }),
      { status: 401 }
    ));
    await expect(refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', clientSecret: 'CS' }))
      .rejects.toBeInstanceOf(InvalidClientError);
  });

  it('throw GoogleAdsApiError com httpStatus em 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('upstream error', { status: 503 }));
    const promise = refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', clientSecret: 'CS' });
    await expect(promise).rejects.toBeInstanceOf(GoogleAdsApiError);
    await expect(promise).rejects.toMatchObject({ httpStatus: 503 });
  });
});
