export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  if (opts.secure) parts.push('Secure');
  if (opts.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}
