import { describe, it, expect, vi } from 'vitest';
import { createDedup } from '../src/lib/dedup';

describe('createDedup', () => {
  it('quando URL vazia, sempre retorna isDuplicate=false (no-op em dev)', async () => {
    const dedup = createDedup({ url: '', token: '' });
    expect(await dedup.checkAndMark('any-key', 60)).toBe(false);
    expect(await dedup.checkAndMark('any-key', 60)).toBe(false);
  });

  it('chama Upstash com SET NX EX quando URL configurada', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: 'OK' }), { status: 200 }));
    const dedup = createDedup({ url: 'https://test.upstash.io', token: 'tok', fetchImpl: fetchMock });

    expect(await dedup.checkAndMark('k1', 86400)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/set/k1/1');
    expect(String(url)).toContain('NX=true');
    expect(String(url)).toContain('EX=86400');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('retorna isDuplicate=true quando Upstash responde result=null', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: null }), { status: 200 }));
    const dedup = createDedup({ url: 'https://test.upstash.io', token: 'tok', fetchImpl: fetchMock });
    expect(await dedup.checkAndMark('k', 86400)).toBe(true);
  });
});
