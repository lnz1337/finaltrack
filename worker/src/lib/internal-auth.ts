import type { Env } from '../types';
import { timingSafeEqualHex } from './crypto';
import { createSupabaseClient } from './supabase';
import { createStructuredLogger } from './structured-log';

export interface InternalAuthContext {
  workspaceIds: string[];
  userId: string;
}

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function decodeBase64Url(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

type JwtVerifyResult =
  | { valid: true; sub: string; exp: number }
  | { valid: false; reason: 'malformed' | 'signature_invalid' | 'expired' };

async function verifySupabaseJwt(jwt: string, secret: string): Promise<JwtVerifyResult> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [headerB64, payloadB64, sigB64] = parts;

  const message = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  let valid: boolean;
  try {
    const sigBytes = decodeBase64Url(sigB64);
    valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(message));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (!valid) return { valid: false, reason: 'signature_invalid' };

  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadB64)));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (!payload.sub || !payload.exp) return { valid: false, reason: 'malformed' };
  if (payload.exp < Math.floor(Date.now() / 1000)) return { valid: false, reason: 'expired' };
  return { valid: true, sub: payload.sub, exp: payload.exp };
}

export async function validateInternalRequest(req: Request, env: Env): Promise<InternalAuthContext> {
  const log = createStructuredLogger(crypto.randomUUID(), Date.now());
  const authHeader = req.headers.get('Authorization') ?? '';
  const hasAuthHeader = req.headers.get('Authorization') !== null;
  const bearerPrefixOk = authHeader.startsWith('Bearer ');
  const bearer = bearerPrefixOk ? authHeader.slice(7) : '';
  const jwt = req.headers.get('X-User-JWT') ?? '';
  const hasJwtHeader = req.headers.get('X-User-JWT') !== null;

  if (!bearer) {
    log.warn('internal_auth_failed', {
      reason: 'invalid_internal_token',
      authorization_header_present: hasAuthHeader,
      bearer_prefix_ok: bearerPrefixOk,
      bearer_empty: true,
      worker_token_configured: !!env.WORKER_INTERNAL_TOKEN,
    });
    throw jsonResponse(401, { error: 'missing_credentials' });
  }
  if (!jwt) {
    log.warn('internal_auth_failed', { reason: 'invalid_user_jwt', x_user_jwt_present: hasJwtHeader, jwt_error: 'missing' });
    throw jsonResponse(401, { error: 'missing_credentials' });
  }

  // Constant-time compare evita timing oracle no token interno.
  // timingSafeEqualHex espera strings hex; encodamos ambos antes de comparar.
  // Length mismatch retorna false imediatamente (info pública; não é secret).
  // Pra inputs do mesmo tamanho, a comparação XOR é constant-time.
  const expectedHex = Array.from(new TextEncoder().encode(env.WORKER_INTERNAL_TOKEN ?? ''))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const givenHex = Array.from(new TextEncoder().encode(bearer))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!timingSafeEqualHex(expectedHex, givenHex)) {
    log.warn('internal_auth_failed', {
      reason: 'invalid_internal_token',
      authorization_header_present: hasAuthHeader,
      bearer_prefix_ok: bearerPrefixOk,
      token_mismatch: true,
      worker_token_configured: !!env.WORKER_INTERNAL_TOKEN,
      // não logamos os valores reais — só os tamanhos pra debug de "vazio vs preenchido"
      given_bearer_length: bearer.length,
      worker_token_length: (env.WORKER_INTERNAL_TOKEN ?? '').length,
    });
    throw jsonResponse(401, { error: 'invalid_token' });
  }

  const verify = await verifySupabaseJwt(jwt, env.SUPABASE_JWT_SECRET);
  if (!verify.valid) {
    log.warn('internal_auth_failed', { reason: 'invalid_user_jwt', x_user_jwt_present: true, jwt_error: verify.reason });
    throw jsonResponse(401, { error: 'invalid_jwt' });
  }

  const sb = createSupabaseClient(env);
  const workspaces = await sb.select<{ id: string }>('workspaces', {
    owner_id: `eq.${verify.sub}`,
    select: 'id',
  });

  return {
    workspaceIds: workspaces.map((w) => w.id),
    userId: verify.sub,
  };
}
