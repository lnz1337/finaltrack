export interface BisectResult {
  ok: number;
  skipped: number;
}

export async function upsertWithBisect<T>(
  rows: T[],
  upsert: (batch: T[]) => Promise<void>,
  logSkipped: (row: T) => void
): Promise<BisectResult> {
  if (rows.length === 0) return { ok: 0, skipped: 0 };
  try {
    await upsert(rows);
    return { ok: rows.length, skipped: 0 };
  } catch {
    if (rows.length === 1) {
      logSkipped(rows[0]);
      return { ok: 0, skipped: 1 };
    }
    const mid = Math.floor(rows.length / 2);
    const left = await upsertWithBisect(rows.slice(0, mid), upsert, logSkipped);
    const right = await upsertWithBisect(rows.slice(mid), upsert, logSkipped);
    return { ok: left.ok + right.ok, skipped: left.skipped + right.skipped };
  }
}
