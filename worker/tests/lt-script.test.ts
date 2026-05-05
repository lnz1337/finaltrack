import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /lt.js', () => {
  it('responde 200 com Content-Type js e Cache-Control 1h', async () => {
    const res = await SELF.fetch('http://test/lt.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
    const body = await res.text();
    expect(body).toContain('__LT_INIT__');
    expect(body).toContain('_lt_visitor');
  });

  it('script lê aliases iOS LTP (lt_gci/lt_wbr/lt_gbr) da URL da LP', async () => {
    const res = await SELF.fetch('http://test/lt.js');
    const body = await res.text();
    // Aliases precisam estar no script pra serem reconhecidos como tracking source
    expect(body).toContain('lt_gci');
    expect(body).toContain('lt_wbr');
    expect(body).toContain('lt_gbr');
  });
});

describe('lt.client alias resolution (sandboxed)', () => {
  // Executa o script numa sandbox JS mínima e captura o payload enviado pra /track/click
  async function runWithUrl(url: string): Promise<Record<string, unknown> | null> {
    const res = await SELF.fetch('http://test/lt.js');
    const source = await res.text();

    let captured: Record<string, unknown> | null = null;
    const sandbox = {
      window: {} as Record<string, unknown>,
      document: {
        cookie: '',
        getElementsByTagName: () => [
          { src: 'http://worker.test/lt.js', dataset: { workspace: 'WS-1' } },
        ],
        addEventListener: () => undefined,
        referrer: '',
      },
      location: new URL(url),
      navigator: {
        sendBeacon: (_url: string, blob: { text: () => Promise<string> }) => {
          // Blob.text() existe no runtime do worker; aqui simulamos
          (blob as { text?: () => Promise<string> }).text!().then((t) => {
            captured = JSON.parse(t);
          });
          return true;
        },
      },
      crypto: { randomUUID: () => 'uuid-fixed' },
      URL,
      URLSearchParams,
      Blob: class Blob {
        private parts: string[];
        constructor(parts: string[]) {
          this.parts = parts;
        }
        text() {
          return Promise.resolve(this.parts.join(''));
        }
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(...Object.keys(sandbox), source)(...Object.values(sandbox));
    // sendBeacon callback é síncrono (then resolve micro-task)
    await new Promise((r) => setTimeout(r, 0));
    return captured;
  }

  it('(a) só gclid puro na URL → payload.gclid populado, payload sem lt_gci', async () => {
    const p = await runWithUrl('http://lp/?gclid=CANON_G');
    expect(p?.gclid).toBe('CANON_G');
    expect(p?.lt_gci).toBeUndefined();
  });

  it('(d) URL sem tracking nem alias → sendBeacon não disparado', async () => {
    const p = await runWithUrl('http://lp/');
    expect(p).toBeNull();
  });

  it('lt_gci na URL → payload.gclid populado, lt_gci omitido', async () => {
    const p = await runWithUrl('http://lp/?lt_gci=ALIAS_G');
    expect(p?.gclid).toBe('ALIAS_G');
    expect(p?.lt_gci).toBeUndefined();
  });

  it('gclid + lt_gci → canonical ganha', async () => {
    const p = await runWithUrl('http://lp/?gclid=CANON&lt_gci=ALIAS');
    expect(p?.gclid).toBe('CANON');
  });

  it('lt_wbr → payload.wbraid', async () => {
    const p = await runWithUrl('http://lp/?lt_wbr=ALIAS_W');
    expect(p?.wbraid).toBe('ALIAS_W');
  });

  it('lt_gbr → payload.gbraid', async () => {
    const p = await runWithUrl('http://lp/?lt_gbr=ALIAS_B');
    expect(p?.gbraid).toBe('ALIAS_B');
  });
});
