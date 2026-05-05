const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(sig);
}

export async function verifyHmacSha256(secret: string, message: string, signatureHex: string): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, message);
  return timingSafeEqualHex(expected, signatureHex.toLowerCase());
}

// Comparação constant-time pra strings hex (e por extensão pra Hottok/HMAC plain).
// Length-different retorna false imediatamente — info pública (não secreta).
// Para length-equal, faz XOR bitwise em todos os chars e checa accumulator no fim,
// nunca short-circuitando em mismatch — garante tempo independente do índice da diferença.
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return bytesToHex(buf);
}

export function hashEmail(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase());
}

export function hashPhone(phone: string): Promise<string> {
  // remove tudo que não for dígito antes de hashear (E.164-friendly)
  const digits = phone.replace(/\D+/g, '');
  return sha256Hex(digits);
}

export interface EncryptedPayload {
  ciphertext: string; // hex
  iv: string; // hex (12 bytes)
}

async function importAesKey(keyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptAesGcm(keyHex: string, plaintext: string): Promise<EncryptedPayload> {
  const key = await importAesKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { ciphertext: bytesToHex(ct), iv: bytesToHex(iv) };
}

export async function decryptAesGcm(keyHex: string, ciphertextHex: string, ivHex: string): Promise<string> {
  const key = await importAesKey(keyHex);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(ivHex) },
    key,
    hexToBytes(ciphertextHex)
  );
  return dec.decode(pt);
}
