import { InvalidGrantError, InvalidClientError } from './errors';

export type RefreshErrorAction = 'mark_inactive' | 'log_critical' | 'transient' | 'log_throw';

export interface RefreshErrorClassification {
  action: RefreshErrorAction;
  reason: string;
}

export function classifyRefreshError(err: unknown): RefreshErrorClassification {
  if (err instanceof InvalidGrantError) {
    return { action: 'mark_inactive', reason: 'invalid_grant' };
  }
  if (err instanceof InvalidClientError) {
    return { action: 'log_critical', reason: 'invalid_client' };
  }
  if (typeof err === 'object' && err !== null && 'httpStatus' in err) {
    const status = (err as { httpStatus: number }).httpStatus;
    if (status >= 500) return { action: 'transient', reason: 'upstream_5xx' };
  }
  return { action: 'log_throw', reason: 'unknown' };
}
