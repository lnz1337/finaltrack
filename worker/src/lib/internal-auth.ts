import type { Env } from '../types';
import { timingSafeEqualHex } from './crypto';
import { createSupabaseClient } from './supabase';

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

async function verifySupabaseJwt(jwt: string, secret: string): Promise<{ sub: string; exp: number } | null> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  const message = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const sigBytes = decodeBase64Url(sigB64);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(message));
  if (!valid) return null;

  let payload: { sub?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadB64)));
  } catch {
    return null;
  }
  if (!payload.sub || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { sub: payload.sub, exp: payload.exp };
}

export async function validateInternalRequest(req: Request, env: Env): Promise<InternalAuthContext> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const jwt = req.headers.get('X-User-JWT') ?? '';

  if (!bearer || !jwt) throw jsonResponse(401, { error: 'missing_credentials' });

  // Constant-time compare evita timing oracle no token interno.
  // timingSafeEqualHex espera strings hex; encodamos ambos antes de comparar.
  // Length mismatch retorna false imediatamente (info pública; não é secret).
  // Pra inputs do mesmo tamanho, a comparação XOR é constant-time.
  const expectedHex = Array.from(new TextEncoder().encode(env.WORKER_INTERNAL_TOKEN))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const givenHex = Array.from(new TextEncoder().encode(bearer))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!timingSafeEqualHex(expectedHex, givenHex)) {
    throw jsonResponse(401, { error: 'invalid_token' });
  }

  const claims = await verifySupabaseJwt(jwt, env.SUPABASE_JWT_SECRET);
  if (!claims) throw jsonResponse(401, { error: 'invalid_jwt' });

  const sb = createSupabaseClient(env);
  const workspaces = await sb.select<{ id: string }>('workspaces', {
    owner_id: `eq.${claims.sub}`,
    select: 'id',
  });

  return {
    workspaceIds: workspaces.map((w) => w.id),
    userId: claims.sub,
  };
}
