import type { SupabaseClient } from './supabase';

export interface OriginalConversion {
  id: string;
  occurred_at: string;
}

// Busca a conversion 'paid' mais antiga pra esse external_order_id no workspace.
// Usado pra resolver a "original" que um refund/chargeback está adjustando.
export async function findOriginalConversion(
  sb: SupabaseClient,
  workspaceId: string,
  externalOrderId: string,
): Promise<OriginalConversion | null> {
  const rows = await sb.select<OriginalConversion>('conversions', {
    workspace_id: `eq.${workspaceId}`,
    external_order_id: `eq.${externalOrderId}`,
    conversion_type: 'eq.paid',
    select: 'id,occurred_at',
    order: 'occurred_at.asc',
    limit: '1',
  });
  return rows[0] ?? null;
}
