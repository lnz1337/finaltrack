'use client';

import { useEffect, useRef, useState } from 'react';

// Cadência adaptativa cravada no spec §9 / decisão 5.7.2:
// 1s, 1s, 2s, 2s, 3s, 3s, 5s (cap), timeout 60s.
const INTERVALS_MS = [1000, 1000, 2000, 2000, 3000, 3000];
const CAP_MS = 5000;
const TIMEOUT_MS = 60000;

export interface SyncStatusRow {
  id: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  started_at: string;
  completed_at: string | null;
  rows_synced: number | null;
  parsed_skipped: number | null;
  partial_skipped: Record<string, unknown> | null;
  error_message: string | null;
}

export interface UseSyncStatusResult {
  status: SyncStatusRow | null;
  isPolling: boolean;
  timedOut: boolean;
  error: string | null;
}

export function useSyncStatus(accountId: string | null, enabled: boolean): UseSyncStatusResult {
  const [status, setStatus] = useState<SyncStatusRow | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled || !accountId) return;

    let cancelled = false;
    startedRef.current = Date.now();
    attemptRef.current = 0;
    setIsPolling(true);
    setTimedOut(false);
    setError(null);

    async function poll() {
      if (cancelled) return;

      const elapsed = Date.now() - (startedRef.current ?? Date.now());
      if (elapsed > TIMEOUT_MS) {
        setIsPolling(false);
        setTimedOut(true);
        return;
      }

      try {
        const res = await fetch(`/api/google-ads/sync-status?account_id=${accountId}`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          setIsPolling(false);
          return;
        }
        const data = (await res.json()) as { row: SyncStatusRow | null };
        if (cancelled) return;
        setStatus(data.row);

        if (data.row && data.row.status !== 'running') {
          setIsPolling(false);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'fetch_error');
        setIsPolling(false);
        return;
      }

      const idx = Math.min(attemptRef.current, INTERVALS_MS.length - 1);
      const next = INTERVALS_MS[idx] ?? CAP_MS;
      attemptRef.current += 1;
      setTimeout(poll, next);
    }

    poll();

    return () => {
      cancelled = true;
      setIsPolling(false);
    };
  }, [accountId, enabled]);

  return { status, isPolling, timedOut, error };
}
