import { InvalidGrantError, GoogleAdsApiError } from './errors';

// PKCE skipado intencionalmente: Worker é confidential client (tem client_secret)
// e Google não exige PKCE pra confidential clients. State HMAC cobre CSRF.
// Decisão 3.A.1 do spec.

export interface ConsentUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
}

export function buildConsentUrl(params: ConsentUrlParams): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent'); // força refresh_token sempre
  url.searchParams.set('state', params.state);
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface ExchangeCodeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export async function exchangeCodeForTokens(params: ExchangeCodeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
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
    throw new GoogleAdsApiError(`oauth_400: ${parsed.error ?? 'unknown'}`, 400, parsed);
  }
  if (!res.ok) {
    throw new GoogleAdsApiError(`oauth_${res.status}`, res.status, await res.text());
  }
  return (await res.json()) as TokenResponse;
}
