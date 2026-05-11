import { describe, it, expect } from 'vitest';
import { classifyRefreshError } from '../../src/lib/google-ads/refresh-token-error-handler';
import { InvalidGrantError, InvalidClientError } from '../../src/lib/google-ads/errors';

describe('classifyRefreshError', () => {
  it('InvalidGrantError → mark_inactive', () => {
    const c = classifyRefreshError(new InvalidGrantError());
    expect(c).toEqual({ action: 'mark_inactive', reason: 'invalid_grant' });
  });

  it('InvalidClientError → log_critical (sem inactive)', () => {
    const c = classifyRefreshError(new InvalidClientError());
    expect(c).toEqual({ action: 'log_critical', reason: 'invalid_client' });
  });

  it('Error 5xx → transient', () => {
    const e = Object.assign(new Error('5xx'), { httpStatus: 502 });
    expect(classifyRefreshError(e)).toEqual({ action: 'transient', reason: 'upstream_5xx' });
  });

  it('Error desconhecido → log_throw (não marca inativo)', () => {
    expect(classifyRefreshError(new Error('???'))).toEqual({ action: 'log_throw', reason: 'unknown' });
  });
});
