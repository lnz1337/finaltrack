import { describe, it, expect } from 'vitest';
import { parseCookies, serializeCookie } from '../src/lib/cookies';

describe('parseCookies', () => {
  it('parse de header cookie simples', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('decode URL-encoded', () => {
    expect(parseCookies('x=hello%20world')).toEqual({ x: 'hello world' });
  });

  it('aceita header vazio ou null', () => {
    expect(parseCookies('')).toEqual({});
    expect(parseCookies(null)).toEqual({});
  });
});

describe('serializeCookie', () => {
  it('serializa com defaults SameSite=Lax e Path=/', () => {
    const c = serializeCookie('foo', 'bar', { maxAge: 3600 });
    expect(c).toContain('foo=bar');
    expect(c).toContain('Path=/');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Max-Age=3600');
  });

  it('inclui Secure quando flag passa', () => {
    expect(serializeCookie('foo', 'bar', { secure: true })).toContain('Secure');
  });

  it('encoda valor', () => {
    expect(serializeCookie('foo', 'a b')).toContain('foo=a%20b');
  });
});
