import { InvalidGrantError, InvalidClientError, GoogleAdsApiError } from './errors';

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
