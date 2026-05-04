import type { Env } from '../types';
import { createSupabaseClient } from './supabase';
import { decryptAesGcm } from './crypto';

export interface ResolvedWebhookSecret {
  workspace_id: string;
  platform: string;
  secret_plaintext: string;
}

export async function resolveWebhookSecret(
  env: Env,
  platform: string,
  endpointToken: string
): Promise<ResolvedWebhookSecret | null> {
  const sb = createSupabaseClient(env);
  const rows = await sb.select<{
    workspace_id: string;
    platform: string;
    secret_encrypted: string;
    secret_iv: string;
  }>('webhook_secrets', {
    endpoint_token: `eq.${endpointToken}`,
    platform: `eq.${platform}`,
    is_active: 'eq.true',
    select: 'workspace_id,platform,secret_encrypted,secret_iv',
    limit: '1',
  });
  if (rows.length === 0) return null;
  const row = rows[0];

  // Bypass de decrypt em dev (placeholders no seed)
  if (env.ENV === 'development') {
    const plain =
      platform === 'kiwify' ? env.DEV_KIWIFY_SECRET :
      platform === 'hotmart' ? env.DEV_HOTMART_SECRET :
      undefined;
    if (!plain) return null;
    return { workspace_id: row.workspace_id, platform, secret_plaintext: plain };
  }

  const plain = await decryptAesGcm(env.ENCRYPTION_KEY, row.secret_encrypted, row.secret_iv);
  return { workspace_id: row.workspace_id, platform, secret_plaintext: plain };
}
