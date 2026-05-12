import { describe, it, expect, vi, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import workerModule from '../../src/index';
import * as syncMod from '../../src/lib/google-ads/sync';
import * as supabaseMod from '../../src/lib/supabase';

const WID = '00000000-0000-0000-0000-000000000001';

function makeMockSb(activeAccounts: Array<{ id: string; workspace_id: string }>) {
  return {
    select: vi.fn().mockResolvedValue(activeAccounts),
    delete: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    rpc: vi.fn().mockResolvedValue([]),
  } as unknown as ReturnType<typeof supabaseMod.createSupabaseClient>;
}

const event = { cron: '0 3 * * *', scheduledTime: Date.now() } as ScheduledEvent;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

describe('scheduled() cron handler', () => {
  afterEach(() => vi.restoreAllMocks());

  it('itera sobre is_active=true accounts e roda cleanup de pending expirados', async () => {
    const mockSb = makeMockSb([{ id: 'acc-1', workspace_id: WID }]);
    vi.spyOn(supabaseMod, 'createSupabaseClient').mockReturnValue(mockSb);
    const syncSpy = vi.spyOn(syncMod, 'syncAccount').mockResolvedValue({ log_id: 'l', status: 'success', rows_synced: 0, duration_ms: 100 });

    await workerModule.scheduled(event, env, ctx);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenCalledWith(env, mockSb, 'acc-1', 'cron');
    // cleanup de pending: delete chamado com filtro expires_at lt now
    expect(mockSb.delete).toHaveBeenCalledWith('oauth_pending_selections', expect.objectContaining({ expires_at: expect.stringContaining('lt.') }));
  });

  it('uma falha não bloqueia próximas accounts', async () => {
    const mockSb = makeMockSb([{ id: 'acc-1', workspace_id: WID }, { id: 'acc-2', workspace_id: WID }]);
    vi.spyOn(supabaseMod, 'createSupabaseClient').mockReturnValue(mockSb);
    const syncSpy = vi.spyOn(syncMod, 'syncAccount')
      .mockRejectedValueOnce(new Error('first_fails'))
      .mockResolvedValueOnce({ log_id: 'l', status: 'success', rows_synced: 0, duration_ms: 100 });

    await workerModule.scheduled(event, env, ctx);

    expect(syncSpy).toHaveBeenCalledTimes(2); // segunda roda mesmo após a primeira falhar
    expect(mockSb.delete).toHaveBeenCalledTimes(1); // cleanup ainda roda
  });

  it('zero accounts ativos: não chama syncAccount, mas roda cleanup', async () => {
    const mockSb = makeMockSb([]);
    vi.spyOn(supabaseMod, 'createSupabaseClient').mockReturnValue(mockSb);
    const syncSpy = vi.spyOn(syncMod, 'syncAccount').mockResolvedValue({ log_id: 'l', status: 'success', rows_synced: 0, duration_ms: 100 });

    await workerModule.scheduled(event, env, ctx);

    expect(syncSpy).not.toHaveBeenCalled();
    expect(mockSb.delete).toHaveBeenCalledTimes(1);
  });
});
