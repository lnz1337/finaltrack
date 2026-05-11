import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { refreshAccessToken, googleAdsSearch } from '../../src/lib/google-ads/client';
import { InvalidGrantError, InvalidClientError, GoogleAdsApiError, RateLimitError, NetworkError } from '../../src/lib/google-ads/errors';

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

describe('googleAdsSearch', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const baseParams = {
    accessToken: 'AT',
    customerId: '1234567890',
    developerToken: 'DT',
    managerCustomerId: null as string | null,
    gaql: 'SELECT campaign.id FROM campaign',
  };

  it('single page sem nextPageToken retorna todas as rows', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [{ campaign: { id: '1' } }, { campaign: { id: '2' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const rows = await googleAdsSearch(baseParams);
    expect(rows.length).toBe(2);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('multi-page concatena via nextPageToken', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ campaign: { id: '1' } }],
        nextPageToken: 'TOKEN_2',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ campaign: { id: '2' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const rows = await googleAdsSearch(baseParams);
    expect(rows.length).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('429 com Retry-After dispara RateLimitError', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('rate limited', {
      status: 429,
      headers: { 'Retry-After': '5' },
    }));
    await expect(googleAdsSearch(baseParams)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('network error (fetch reject) dispara NetworkError após retries', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(googleAdsSearch({ ...baseParams, retries: 0 })).rejects.toBeInstanceOf(NetworkError);
  });

  it('manager_customer_id presente adiciona header login-customer-id', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await googleAdsSearch({ ...baseParams, managerCustomerId: '9999999999' });
    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['login-customer-id']).toBe('9999999999');
  });
});
