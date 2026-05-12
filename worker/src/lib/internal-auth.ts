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

type JwtDecodeResult =
  | { ok: true; sub: string; exp: number }
  | { ok: false; reason: 'malformed' | 'missing_claims' | 'expired' };

// Supabase moderno assina o access_token com ES256 (chave assimétrica via JWKS),
// não HS256 + shared secret. O Worker NÃO verifica a assinatura — só decoda e valida
// claims sintaticamente — porque:
//   1. WORKER_INTERNAL_TOKEN (comparado timing-safe acima) é a primary auth do canal App→Worker.
//   2. JWT verify aqui seria defense-in-depth, não primary defense.
//   3. App→Worker é canal confidencial entre serviços controlados (mesma operação).
// TECH DEBT (pre-prod): migrar pra verificação JWKS real (lib jose + cache do endpoint JWKS).
// Tracker em docs/plans/phase-1-status.md.
function decodeSupabaseJwt(jwt: string): JwtDecodeResult {
  const parts = jwt.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload.sub || !payload.exp) return { ok: false, reason: 'missing_claims' };
  if (payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };
  return { ok: true, sub: payload.sub, exp: payload.exp };
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

  const decoded = decodeSupabaseJwt(jwt);
  if (!decoded.ok) {
    log.warn('internal_auth_failed', { reason: 'invalid_user_jwt', x_user_jwt_present: true, jwt_error: decoded.reason });
    throw jsonResponse(401, { error: 'invalid_jwt' });
  }

  // workspaces.owner_id tem FK pra auth.users — uma linha aqui já implica que o user existe.
  const sb = createSupabaseClient(env);
  const workspaces = await sb.select<{ id: string }>('workspaces', {
    owner_id: `eq.${decoded.sub}`,
    select: 'id',
  });
  if (workspaces.length === 0) {
    log.warn('internal_auth_failed', { reason: 'invalid_user_jwt', x_user_jwt_present: true, jwt_error: 'no_workspace' });
    throw jsonResponse(401, { error: 'invalid_jwt' });
  }

  return {
    workspaceIds: workspaces.map((w) => w.id),
    userId: decoded.sub,
  };
}
