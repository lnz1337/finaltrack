import { InvalidGrantError, InvalidClientError, GoogleAdsApiError, RateLimitError, NetworkError } from './errors';
import { GOOGLE_ADS_API_BASE } from './constants';

export interface RefreshTokenParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export interface RefreshTokenResult {
  access_token: string;
  expires_in: number;
}

export async function refreshAccessToken(p: RefreshTokenParams): Promise<RefreshTokenResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: p.refreshToken,
    client_id: p.clientId,
    client_secret: p.clientSecret,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (res.status === 400) {
    let parsed: { error?: string } = {};
    try { parsed = (await res.clone().json()) as { error?: string }; } catch { /* noop */ }
    if (parsed.error === 'invalid_grant') throw new InvalidGrantError();
    throw new GoogleAdsApiError(`refresh_400: ${parsed.error ?? 'unknown'}`, 400, parsed);
  }
  if (res.status === 401) {
    let parsed: { error?: string } = {};
    try { parsed = (await res.clone().json()) as { error?: string }; } catch { /* noop */ }
    if (parsed.error === 'invalid_client' || parsed.error === 'unauthorized_client') {
      throw new InvalidClientError(parsed.error);
    }
    throw new GoogleAdsApiError(`refresh_401`, 401, parsed);
  }
  if (!res.ok) {
    throw new GoogleAdsApiError(`refresh_${res.status}`, res.status, await res.text());
  }
  return (await res.json()) as RefreshTokenResult;
}

export interface GoogleAdsSearchParams {
  accessToken: string;
  customerId: string;
  developerToken: string;
  managerCustomerId: string | null;
  gaql: string;
  pageSize?: number;
  retries?: number; // default 0; usado em testes pra simular sem retries
}

export async function googleAdsSearch<T = unknown>(params: GoogleAdsSearchParams): Promise<T[]> {
  const pageSize = params.pageSize ?? 1000;
  const url = `${GOOGLE_ADS_API_BASE}/customers/${params.customerId}/googleAds:search`;

  const baseHeaders: Record<string, string> = {
    Authorization: `Bearer ${params.accessToken}`,
    'developer-token': params.developerToken,
    'content-type': 'application/json',
  };
  if (params.managerCustomerId) {
    baseHeaders['login-customer-id'] = params.managerCustomerId;
  }

  const allResults: T[] = [];
  let pageToken: string | undefined;

  do {
    const body: Record<string, unknown> = { query: params.gaql, pageSize };
    if (pageToken) body.pageToken = pageToken;

    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: baseHeaders, body: JSON.stringify(body) });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'fetch_failed');
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0', 10) || undefined;
      throw new RateLimitError(retryAfter);
    }
    if (!res.ok) {
      throw new Error(`googleAdsSearch ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { results?: T[]; nextPageToken?: string };
    if (Array.isArray(json.results)) allResults.push(...json.results);
    pageToken = json.nextPageToken;
  } while (pageToken);

  return allResults;
}

export interface ListAccessibleParams {
  accessToken: string;
  developerToken: string;
}

export async function listAccessibleCustomers(p: ListAccessibleParams): Promise<string[]> {
  const url = `${GOOGLE_ADS_API_BASE}/customers:listAccessibleCustomers`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${p.accessToken}`,
      'developer-token': p.developerToken,
    },
  });
  if (!res.ok) {
    throw new Error(`listAccessibleCustomers ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { resourceNames?: string[] };
  if (!Array.isArray(json.resourceNames)) return [];
  return json.resourceNames.map((rn) => rn.replace(/^customers\//, ''));
}
