import type { ConversionType } from '../types';
import { ORIGINAL_CONVERSION_WINDOW_DAYS } from './constants';

export interface CheckAdjustmentWindowArgs {
  platform: string;
  conversionType: ConversionType;
  originalConversion: { id: string; occurred_at: string } | null;
  externalOrderId: string;
  workspaceId: string;
  now?: Date;
}

// Loga warn se um refund/chargeback chegar fora da janela 55d do Google Ads.
// TODO(fase-3): Data Manager API entry vai criar conversion_uploads com status='skipped_window_expired'.
export function checkAdjustmentWindow(args: CheckAdjustmentWindowArgs): void {
  if (args.conversionType !== 'refund' && args.conversionType !== 'chargeback') return;
  if (!args.originalConversion) return;
  const nowMs = (args.now ?? new Date()).getTime();
  const originalMs = new Date(args.originalConversion.occurred_at).getTime();
  const ageDays = (nowMs - originalMs) / 86400_000;
  if (ageDays <= ORIGINAL_CONVERSION_WINDOW_DAYS) return;
  console.warn(
    `[webhook-${args.platform}] Conversion adjustment fora da janela ${ORIGINAL_CONVERSION_WINDOW_DAYS}d ` +
      `(${Math.floor(ageDays)}d): original_conversion_id=${args.originalConversion.id} ` +
      `order_id=${args.externalOrderId} workspace_id=${args.workspaceId}. ` +
      `TODO(fase-3): criar conversion_upload com status='skipped_window_expired' quando Data Manager API entrar.`
  );
}
