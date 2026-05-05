import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkAdjustmentWindow } from '../src/lib/conversion-window';
import { ORIGINAL_CONVERSION_WINDOW_DAYS } from '../src/lib/constants';

describe('ORIGINAL_CONVERSION_WINDOW_DAYS', () => {
  it('é 55 (limite hard do Google Ads pra adjustments)', () => {
    expect(ORIGINAL_CONVERSION_WINDOW_DAYS).toBe(55);
  });
});

describe('checkAdjustmentWindow', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function originalAt(daysAgo: number, msExtra = 0) {
    const d = new Date(Date.now() - daysAgo * 86400_000 - msExtra);
    return { id: 'orig-uuid', occurred_at: d.toISOString() };
  }

  function baseArgs(overrides: Record<string, unknown> = {}) {
    return {
      platform: 'kiwify',
      conversionType: 'refund' as const,
      originalConversion: originalAt(60),
      externalOrderId: 'ord-1',
      workspaceId: 'ws-1',
      ...overrides,
    };
  }

  it('(a) refund dentro da janela (30d) → warn não emitido', () => {
    checkAdjustmentWindow(baseArgs({ originalConversion: originalAt(30) }));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(b) refund fora da janela (60d) → warn emitido com formato esperado', () => {
    checkAdjustmentWindow(baseArgs({ originalConversion: originalAt(60) }));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('[webhook-kiwify]');
    expect(msg).toContain('fora da janela 55d');
    expect(msg).toContain('(60d)');
    expect(msg).toContain('original_conversion_id=orig-uuid');
    expect(msg).toContain('order_id=ord-1');
    expect(msg).toContain('workspace_id=ws-1');
    expect(msg).toContain("TODO(fase-3)");
    expect(msg).toContain("status='skipped_window_expired'");
  });

  it('(c) edge exato 55d → warn não emitido (> estrito, não >=)', () => {
    checkAdjustmentWindow(baseArgs({ originalConversion: originalAt(55) }));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(d) edge 55d + 1ms → warn emitido', () => {
    checkAdjustmentWindow(baseArgs({ originalConversion: originalAt(55, 1) }));
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('(e) refund sem original (null) → não emite warn, não crasha', () => {
    expect(() =>
      checkAdjustmentWindow(baseArgs({ originalConversion: null }))
    ).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('(f) regressão: paid fora da janela → warn não emitido (só refund/chargeback dispara)', () => {
    checkAdjustmentWindow(
      baseArgs({ conversionType: 'paid', originalConversion: originalAt(60) })
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('chargeback fora da janela → warn emitido (mesmo path de refund)', () => {
    checkAdjustmentWindow(
      baseArgs({
        platform: 'hotmart',
        conversionType: 'chargeback',
        originalConversion: originalAt(60),
      })
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[webhook-hotmart]');
  });

  it('outros conversion_types (pix_generated, billet_generated, abandoned) não disparam warn', () => {
    for (const ct of ['pix_generated', 'billet_generated', 'abandoned'] as const) {
      checkAdjustmentWindow(
        baseArgs({ conversionType: ct, originalConversion: originalAt(60) })
      );
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
