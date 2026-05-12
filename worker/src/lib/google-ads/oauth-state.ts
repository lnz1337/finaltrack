import { hmacSha256Hex, timingSafeEqualHex } from '../crypto';

export interface StatePayload {
  workspace_id: string;
  nonce: string;
  exp: number; // unix seconds
}

function b64urlEncode(s: string): string {
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  return atob(padded);
}

export async function signState(
  fields: { workspace_id: string },
  secret: string,
  ttlSeconds: number
): Promise<string> {
  const payload: StatePayload = {
    workspace_id: fields.workspace_id,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = await hmacSha256Hex(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyState(
  stateFromQuery: string,
  stateFromCookie: string,
  secret: string
): Promise<StatePayload | null> {
  if (!stateFromQuery || !stateFromCookie) return null;
  if (stateFromQuery.length !== stateFromCookie.length) return null;
  if (!timingSafeEqualHex(stateFromQuery, stateFromCookie)) return null;

  const parts = stateFromQuery.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = await hmacSha256Hex(secret, payloadB64);
  if (!timingSafeEqualHex(expectedSig, sig)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
