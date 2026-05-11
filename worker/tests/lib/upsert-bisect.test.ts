import { describe, it, expect, vi } from 'vitest';
import { upsertWithBisect } from '../../src/lib/upsert-bisect';

describe('upsertWithBisect', () => {
  it('empty array → ok=0 skipped=0 sem chamar upsertFn', async () => {
    const upsert = vi.fn();
    const log = vi.fn();
    const r = await upsertWithBisect([], upsert, log);
    expect(r).toEqual({ ok: 0, skipped: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('all ok → 1 chamada apenas, ok=N skipped=0', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const r = await upsertWithBisect([1, 2, 3, 4], upsert, log);
    expect(r).toEqual({ ok: 4, skipped: 0 });
    expect(upsert).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it('single row falha → log + skipped=1', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('constraint violation'));
    const log = vi.fn();
    const r = await upsertWithBisect([{ id: 'bad' }], upsert, log);
    expect(r).toEqual({ ok: 0, skipped: 1 });
    expect(log).toHaveBeenCalledWith({ id: 'bad' });
  });

  it('metade falha → bisect recursivo, ok=2 skipped=2', async () => {
    const upsert = vi.fn().mockImplementation(async (batch: Array<{ id: number; bad?: boolean }>) => {
      if (batch.some((r) => r.bad)) throw new Error('bad row');
    });
    const log = vi.fn();
    const rows = [
      { id: 1 },
      { id: 2, bad: true },
      { id: 3 },
      { id: 4, bad: true },
    ];
    const r = await upsertWithBisect(rows, upsert, log);
    expect(r).toEqual({ ok: 2, skipped: 2 });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('1000 rows com 1 bad: log₂(1000) ≈ 10 retries, não 1000', async () => {
    let calls = 0;
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    rows[500] = { id: 500, bad: true } as { id: number; bad?: boolean };
    const upsert = vi.fn().mockImplementation(async (batch: Array<{ id: number; bad?: boolean }>) => {
      calls++;
      if (batch.some((r) => r.bad)) throw new Error('bad');
    });
    const log = vi.fn();
    const r = await upsertWithBisect(rows, upsert, log);
    expect(r).toEqual({ ok: 999, skipped: 1 });
    expect(calls).toBeLessThan(30);
  });
});
