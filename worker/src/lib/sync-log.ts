import type { SupabaseClient } from './supabase';

export interface InsertSyncLogFields {
  google_ads_account_id: string;
  sync_type: 'metadata' | 'cost'; // REQUIRED — TS força explícito
  status: 'running';
  trace_id: string;
  date_range_start?: string; // YYYY-MM-DD
  date_range_end?: string;
  triggered_by?: 'on_demand' | 'cron' | 'manual';
}

export interface UpdateSyncLogFields {
  status?: 'success' | 'partial' | 'failed';
  rows_synced?: number;
  parsed_skipped?: number;
  partial_skipped?: Record<string, unknown>;
  error_message?: string;
  duration_ms?: number;
  completed_at?: string;
}

export async function insertSyncLog(sb: SupabaseClient, fields: InsertSyncLogFields): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const row = {
    ...fields,
    date_range_start: fields.date_range_start ?? today,
    date_range_end: fields.date_range_end ?? today,
    triggered_by: fields.triggered_by ?? 'on_demand',
  };
  // Pra ler o id de volta, fazemos insert + select pelo trace_id (único).
  await sb.insert('google_ads_sync_log', row);
  const rows = await sb.select<{ id: string }>('google_ads_sync_log', {
    trace_id: `eq.${fields.trace_id}`,
    select: 'id',
    limit: '1',
  });
  if (!rows[0]) throw new Error('insertSyncLog: row not found after insert');
  return rows[0].id;
}

export async function updateSyncLog(
  sb: SupabaseClient,
  logId: string,
  patch: UpdateSyncLogFields
): Promise<void> {
  await sb.update('google_ads_sync_log', { id: `eq.${logId}` }, patch);
}
