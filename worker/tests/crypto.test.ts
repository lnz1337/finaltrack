import { describe, it, expect } from 'vitest';
import {
  hmacSha256Hex,
  verifyHmacSha256,
  sha256Hex,
  hashEmail,
  encryptAesGcm,
  decryptAesGcm,
  timingSafeEqualHex,
} from '../src/lib/crypto';

describe('hmacSha256Hex', () => {
  it('produz hex previsível', async () => {
    const sig = await hmacSha256Hex('secret', 'hello');
    expect(sig).toBe('88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b');
  });
});

describe('verifyHmacSha256', () => {
  it('aceita assinatura correta', async () => {
    const ok = await verifyHmacSha256('secret', 'hello', '88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b');
    expect(ok).toBe(true);
  });

  it('rejeita assinatura errada', async () => {
    expect(await verifyHmacSha256('secret', 'hello', 'deadbeef')).toBe(false);
  });

  it('comparação é case-insensitive em hex', async () => {
    expect(await verifyHmacSha256('secret', 'hello', '88AAB3EDE8D3ADF94D26AB90D3BAFD4A2083070C3BCCE9C014EE04A443847C0B')).toBe(true);
  });
});

describe('sha256Hex / hashEmail', () => {
  it('sha256Hex de string', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashEmail normaliza (lowercase + trim)', async () => {
    const a = await hashEmail('  Foo@BAR.com ');
    const b = await hashEmail('foo@bar.com');
    expect(a).toBe(b);
  });
});

describe('timingSafeEqualHex', () => {
  it('strings idênticas → true', () => {
    expect(timingSafeEqualHex('abc123', 'abc123')).toBe(true);
  });

  it('strings de mesmo length, conteúdo diferente → false', () => {
    expect(timingSafeEqualHex('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqualHex('abc123', 'xbc123')).toBe(false); // diferença no início
  });

  it('strings de length diferente → false', () => {
    expect(timingSafeEqualHex('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualHex('', 'a')).toBe(false);
  });

  it('strings vazias iguais → true', () => {
    expect(timingSafeEqualHex('', '')).toBe(true);
  });
});

describe('AES-GCM round-trip', () => {
  it('encrypt → decrypt recupera plaintext', async () => {
    const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 32 bytes hex
    const plaintext = 'meu segredo do kiwify';
    const { ciphertext, iv } = await encryptAesGcm(key, plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(iv.length).toBe(24); // 12 bytes hex
    const back = await decryptAesGcm(key, ciphertext, iv);
    expect(back).toBe(plaintext);
  });
});
