import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStructuredLogger } from '../../src/lib/structured-log';

describe('createStructuredLogger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('emite JSON com level, event, trace_id, elapsed_ms', () => {
    const traceId = '00000000-0000-0000-0000-000000000abc';
    const startedAt = Date.now() - 1500;
    const log = createStructuredLogger(traceId, startedAt);

    log.info('phase_started', { phase: 'campaigns' });

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const out = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    expect(out.level).toBe('info');
    expect(out.event).toBe('phase_started');
    expect(out.trace_id).toBe(traceId);
    expect(out.elapsed_ms).toBeGreaterThanOrEqual(1500);
    expect(out.phase).toBe('campaigns');
  });

  it('warn e error usam mesmo schema com level diferente', () => {
    const log = createStructuredLogger('t', Date.now());
    log.warn('row_skipped', { table: 'campaigns', row_id: 'x' });
    log.error('sync_failed', { reason: 'rate_limited' });

    const warnOut = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    const errorOut = JSON.parse(consoleErrorSpy.mock.calls[1][0] as string);
    expect(warnOut.level).toBe('warn');
    expect(warnOut.event).toBe('row_skipped');
    expect(errorOut.level).toBe('error');
    expect(errorOut.event).toBe('sync_failed');
  });

  it('caller não pode sobrescrever campos reservados', () => {
    const log = createStructuredLogger('t', Date.now());
    log.info('e', { level: 'fake', trace_id: 'fake', elapsed_ms: 9999 });
    const out = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    expect(out.level).toBe('info');
    expect(out.trace_id).toBe('t');
    expect(out.elapsed_ms).toBeLessThan(9999);
  });
});
