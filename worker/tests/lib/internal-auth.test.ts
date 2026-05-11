import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { validateInternalRequest } from '../../src/lib/internal-auth';

const VALID_TOKEN = 'test-internal-token';
const VALID_JWT_SECRET = 'super-secret-jwt-for-tests';

async function makeJwt(secret: string, payload: Record<string, unknown>, expSecondsFromNow = 3600): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { sub: 'user-123', exp: now + expSecondsFromNow, iat: now, ...payload };
  const enc = (obj: object) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const message = `${enc(header)}.${enc(fullPayload)}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${message}.${sigB64}`;
}

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://test.workers.dev/api/google-ads/sync', {
    method: 'POST',
    headers,
  });
}

describe('validateInternalRequest', () => {
  beforeEach(() => {
    Object.assign(env, {
      WORKER_INTERNAL_TOKEN: VALID_TOKEN,
      SUPABASE_JWT_SECRET: VALID_JWT_SECRET,
    });
  });

  it('rejeita 401 quando bearer ausente', async () => {
    const req = makeRequest({});
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando bearer incorreto', async () => {
    const jwt = await makeJwt(VALID_JWT_SECRET, { sub: 'user-123' });
    const req = makeRequest({
      Authorization: 'Bearer wrong-token',
      'X-User-JWT': jwt,
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando JWT signature inválida', async () => {
    const jwt = await makeJwt('wrong-secret', { sub: 'user-123' });
    const req = makeRequest({
      Authorization: `Bearer ${VALID_TOKEN}`,
      'X-User-JWT': jwt,
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando JWT expirado', async () => {
    const jwt = await makeJwt(VALID_JWT_SECRET, { sub: 'user-123' }, -10);
    const req = makeRequest({
      Authorization: `Bearer ${VALID_TOKEN}`,
      'X-User-JWT': jwt,
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('aceita request válido e retorna workspaceIds + userId', async () => {
    const SEED_USER_ID = (env as { TEST_SEED_USER_ID?: string }).TEST_SEED_USER_ID
      ?? 'replace-with-actual-seed-user-id';
    const jwt = await makeJwt(VALID_JWT_SECRET, { sub: SEED_USER_ID });
    const req = makeRequest({
      Authorization: `Bearer ${VALID_TOKEN}`,
      'X-User-JWT': jwt,
    });
    const result = await validateInternalRequest(req, env);
    expect(result.userId).toBe(SEED_USER_ID);
    expect(Array.isArray(result.workspaceIds)).toBe(true);
    expect(result.workspaceIds.length).toBeGreaterThanOrEqual(1);
  });
});
