import type { MatchMethod } from '../types';
import type { SupabaseClient } from './supabase';

export interface MatchInput {
  click_id_from_payload?: string;
  gclid_from_payload?: string;
}

export interface MatchResult {
  click_id: string | null;
  match_method: MatchMethod;
}

const NINETY_DAYS_MS = 90 * 86400_000;

export async function matchConversion(
  sb: SupabaseClient,
  workspaceId: string,
  input: MatchInput
): Promise<MatchResult> {
  // 1. click_id direto
  if (input.click_id_from_payload) {
    const rows = await sb.select<{ click_id: string }>('clicks', {
      workspace_id: `eq.${workspaceId}`,
      click_id: `eq.${input.click_id_from_payload}`,
      select: 'click_id',
      limit: '1',
    });
    if (rows.length > 0) {
      return { click_id: rows[0].click_id, match_method: 'click_id' };
    }
  }

  // 2. gclid in payload (90d)
  if (input.gclid_from_payload) {
    const since = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
    const rows = await sb.select<{ click_id: string }>('clicks', {
      workspace_id: `eq.${workspaceId}`,
      gclid: `eq.${input.gclid_from_payload}`,
      clicked_at: `gte.${since}`,
      select: 'click_id',
      order: 'clicked_at.desc',
      limit: '1',
    });
    if (rows.length > 0) {
      return { click_id: rows[0].click_id, match_method: 'gclid_in_payload' };
    }
  }

  return { click_id: null, match_method: 'unmatched' };
}
