import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import { validateInternalRequest } from '../../src/lib/internal-auth';

const VALID_TOKEN = 'test-internal-token';

// O Worker decoda o X-User-JWT sem verificar assinatura (Supabase usa ES256/JWKS;
// WORKER_INTERNAL_TOKEN é a primary auth). Então a "assinatura" aqui é só placeholder.
function makeJwt(payload: Record<string, unknown>, expSecondsFromNow = 3600): string {
  const header = { alg: 'ES256', typ: 'JWT', kid: 'test-kid' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { sub: 'user-123', exp: now + expSecondsFromNow, iat: now, ...payload };
  const enc = (obj: object) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc(header)}.${enc(fullPayload)}.placeholder-signature`;
}

function makeRequest(headers: Record<string, string>): Request {
  return new Request('https://test.workers.dev/api/google-ads/sync', {
    method: 'POST',
    headers,
  });
}

describe('validateInternalRequest', () => {
  beforeEach(() => {
    Object.assign(env, { WORKER_INTERNAL_TOKEN: VALID_TOKEN });
  });

  afterEach(() => {
    Object.assign(env, { WORKER_INTERNAL_TOKEN: 'test-internal-token-default' });
  });

  it('rejeita 401 quando bearer ausente', async () => {
    const req = makeRequest({});
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando bearer incorreto', async () => {
    const jwt = makeJwt({ sub: 'user-123' });
    const req = makeRequest({
      Authorization: 'Bearer wrong-token',
      'X-User-JWT': jwt,
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando JWT malformado', async () => {
    const req = makeRequest({
      Authorization: `Bearer ${VALID_TOKEN}`,
      'X-User-JWT': 'not.a-valid-jwt',
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando JWT expirado', async () => {
    const jwt = makeJwt({ sub: 'user-123' }, -10);
    const req = makeRequest({
      Authorization: `Bearer ${VALID_TOKEN}`,
      'X-User-JWT': jwt,
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('rejeita 401 quando user do JWT não tem workspace', async () => {
    const jwt = makeJwt({ sub: '00000000-0000-0000-0000-0000000000ff' });
    const req = makeRequest({
      Authorization: `Bearer ${VALID_TOKEN}`,
      'X-User-JWT': jwt,
    });
    await expect(validateInternalRequest(req, env)).rejects.toMatchObject({ status: 401 });
  });

  it('aceita request válido e retorna workspaceIds + userId', async () => {
    const SEED_USER_ID = (env as { TEST_SEED_USER_ID?: string }).TEST_SEED_USER_ID
      ?? 'replace-with-actual-seed-user-id';
    const jwt = makeJwt({ sub: SEED_USER_ID });
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
