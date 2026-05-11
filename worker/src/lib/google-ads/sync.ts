import type { Env } from '../../types';
import { createSupabaseClient } from '../supabase';
import { decryptAesGcm } from '../crypto';
import { createStructuredLogger } from '../structured-log';
import { insertSyncLog, updateSyncLog } from '../sync-log';
import { upsertWithBisect } from '../upsert-bisect';
import {
  refreshAccessToken,
  googleAdsSearch,
} from './client';
import {
  CAMPAIGN_QUERY,
  adGroupQuery,
  adQuery,
  assetGroupQuery,
} from './queries';
import {
  parseCampaignRow,
  parseAdGroupRow,
  parseAdRow,
  parseAssetGroupRow,
} from './parsers';
import {
  TimeBudgetError,
  InvalidGrantError,
} from './errors';
import { classifyRefreshError } from './refresh-token-error-handler';

const WORKER_BUDGET_MS = 28000;
const ZOMBIE_THRESHOLD_MIN = 5;

export interface GoogleAdsAccountRow {
  id: string;
  workspace_id: string;
  customer_id: string;
  manager_customer_id: string | null;
  refresh_token_encrypted: string;
  refresh_token_iv: string;
  is_active: boolean;
}

export interface SyncResult {
  log_id: string;
  status: 'success' | 'partial' | 'failed';
  rows_synced: number;
  duration_ms: number;
}

export async function syncAccount(env: Env, account: GoogleAdsAccountRow): Promise<SyncResult> {
  const sb = createSupabaseClient(env);
  const traceId = crypto.randomUUID();
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const log = createStructuredLogger(traceId, startedAt);

  log.info('sync_start', { account_id: account.id, customer_id: account.customer_id });

  // Passo 0: zombie cleanup
  const zombieThresholdIso = new Date(startedAt - ZOMBIE_THRESHOLD_MIN * 60_000).toISOString();
  await sb.update('google_ads_sync_log',
    { google_ads_account_id: `eq.${account.id}`, status: 'eq.running', started_at: `lt.${zombieThresholdIso}` },
    { status: 'failed', error_message: 'zombie_timeout', completed_at: startedAtIso }
  );

  // Passo 1: 409 se há run 'running' < 5min
  const inProgress = await sb.select<{ id: string }>('google_ads_sync_log', {
    google_ads_account_id: `eq.${account.id}`,
    status: 'eq.running',
    started_at: `gte.${zombieThresholdIso}`,
    select: 'id',
    limit: '1',
  });
  if (inProgress.length > 0) {
    log.warn('sync_in_progress', { existing_log_id: inProgress[0].id });
    throw new Error('sync_in_progress');
  }

  // Passo 2: insere sync_log status=running
  const logId = await insertSyncLog(sb, {
    google_ads_account_id: account.id,
    sync_type: 'metadata',
    status: 'running',
    trace_id: traceId,
    triggered_by: 'on_demand',
  });

  function checkBudget(reason: string) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > WORKER_BUDGET_MS) throw new TimeBudgetError(reason, elapsed);
  }

  let rowsSynced = 0;
  let parsedSkipped = 0;
  let phaseCompleted: 'init' | 'campaigns' | 'ad_groups' | 'ads' = 'init';
  let partialSkipped: Record<string, unknown> | null = null;

  try {
    // Re-fetch encrypted token from DB to ensure we use the persisted value
    // (callers may pass empty strings for convenience in tests and cron dispatchers)
    const freshAccount = await sb.select<{ refresh_token_encrypted: string; refresh_token_iv: string }>(
      'google_ads_accounts',
      { id: `eq.${account.id}`, select: 'refresh_token_encrypted,refresh_token_iv', limit: '1' }
    );
    if (!freshAccount[0]) throw new Error(`account_not_found: ${account.id}`);
    const refreshToken = await decryptAesGcm(env.ENCRYPTION_KEY, freshAccount[0].refresh_token_encrypted, freshAccount[0].refresh_token_iv);
    const tokens = await refreshAccessToken({
      refreshToken,
      clientId: env.GOOGLE_ADS_CLIENT_ID,
      clientSecret: env.GOOGLE_ADS_CLIENT_SECRET,
    });
    log.info('access_token_refreshed', { expires_in: tokens.expires_in });

    const campaignsCount = await syncCampaigns(env, sb, account, tokens.access_token, log, startedAtIso);
    rowsSynced += campaignsCount.ok;
    parsedSkipped += campaignsCount.skipped;
    phaseCompleted = 'campaigns';

    checkBudget('before_ad_groups');
    const campaigns = await sb.select<{ id: string; google_campaign_id: string; campaign_type: string | null }>(
      'campaigns',
      { google_ads_account_id: `eq.${account.id}`, select: 'id,google_campaign_id,campaign_type' }
    );
    const adGroupTotal = await syncAdGroupsAndAssetGroups(env, sb, account, tokens.access_token, campaigns, log, startedAtIso, checkBudget);
    rowsSynced += adGroupTotal.ok;
    parsedSkipped += adGroupTotal.skipped;
    phaseCompleted = 'ad_groups';

    checkBudget('before_ads');
    const adGroups = await sb.select<{ id: string; google_ad_group_id: string; entity_type: string }>(
      'ad_groups',
      {
        select: 'id,google_ad_group_id,entity_type',
      }
    );
    const adsTotal = await syncAds(env, sb, account, tokens.access_token, adGroups, log, startedAtIso, checkBudget);
    rowsSynced += adsTotal.ok;
    parsedSkipped += adsTotal.skipped;
    phaseCompleted = 'ads';

    checkBudget('before_mark_removed');
    const removed = await sb.rpc<Array<{ campaigns_marked: number; ad_groups_marked: number; ads_marked: number }>>(
      'mark_removed_for_account',
      { p_account_id: account.id, p_started_at: startedAtIso }
    );
    log.info('mark_removed', removed[0] as Record<string, unknown>);

    await sb.update('google_ads_accounts', { id: `eq.${account.id}` }, { last_synced_at: startedAtIso });
    const durationMs = Date.now() - startedAt;
    await updateSyncLog(sb, logId, {
      status: 'success', rows_synced: rowsSynced, parsed_skipped: parsedSkipped,
      duration_ms: durationMs, completed_at: new Date().toISOString(),
    });
    log.info('sync_success', { rows_synced: rowsSynced, parsed_skipped: parsedSkipped, duration_ms: durationMs });

    return { log_id: logId, status: 'success', rows_synced: rowsSynced, duration_ms: durationMs };

  } catch (err) {
    const durationMs = Date.now() - startedAt;

    if (err instanceof TimeBudgetError) {
      partialSkipped = {
        reason: err.reason,
        elapsed_ms: err.elapsedMs,
        phase_completed: phaseCompleted,
        skipped: ['mark_removed', phaseCompleted === 'campaigns' ? 'ad_groups+ads' : phaseCompleted === 'ad_groups' ? 'ads' : 'remaining'],
      };
      await updateSyncLog(sb, logId, {
        status: 'partial', rows_synced: rowsSynced, parsed_skipped: parsedSkipped,
        partial_skipped: partialSkipped, duration_ms: durationMs, completed_at: new Date().toISOString(),
      });
      log.warn('sync_partial', partialSkipped);
      return { log_id: logId, status: 'partial', rows_synced: rowsSynced, duration_ms: durationMs };
    }

    const classification = classifyRefreshError(err);
    if (classification.action === 'mark_inactive') {
      await sb.update('google_ads_accounts', { id: `eq.${account.id}` }, { is_active: false });
      log.error('account_marked_inactive', { reason: classification.reason });
    }

    await updateSyncLog(sb, logId, {
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });
    log.error('sync_failed', { reason: classification.reason });
    throw err;
  }
}

async function syncCampaigns(env: Env, sb: ReturnType<typeof createSupabaseClient>, account: GoogleAdsAccountRow, accessToken: string, log: ReturnType<typeof createStructuredLogger>, syncedAt: string): Promise<{ ok: number; skipped: number }> {
  const rows = await googleAdsSearch({
    accessToken, customerId: account.customer_id, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
    managerCustomerId: account.manager_customer_id, gaql: CAMPAIGN_QUERY,
  });
  let parsedSkipped = 0;
  const parsed = rows.map((r) => {
    const p = parseCampaignRow(r);
    if (!p) parsedSkipped++;
    return p;
  }).filter((p): p is NonNullable<typeof p> => p !== null);

  const upsertRows = parsed.map((p) => ({
    google_ads_account_id: account.id,
    ...p,
    last_synced_at: syncedAt,
  }));

  const result = await upsertWithBisect(
    upsertRows,
    (batch) => sb.upsert('campaigns', batch, { onConflict: 'google_ads_account_id,google_campaign_id' }),
    (skipped) => log.warn('upsert_row_skipped', { table: 'campaigns', google_campaign_id: skipped.google_campaign_id })
  );
  return { ok: result.ok, skipped: parsedSkipped + result.skipped };
}

async function syncAdGroupsAndAssetGroups(
  env: Env, sb: ReturnType<typeof createSupabaseClient>, account: GoogleAdsAccountRow,
  accessToken: string, campaigns: Array<{ id: string; google_campaign_id: string; campaign_type: string | null }>,
  log: ReturnType<typeof createStructuredLogger>, syncedAt: string,
  checkBudget: (reason: string) => void
): Promise<{ ok: number; skipped: number }> {
  let totalOk = 0;
  let totalSkipped = 0;
  let processed = 0;

  for (let i = 0; i < campaigns.length; i += 5) {
    const batch = campaigns.slice(i, i + 5);
    await Promise.all(batch.map(async (c) => {
      const isPmaxOrDg = c.campaign_type === 'PERFORMANCE_MAX' || c.campaign_type === 'DEMAND_GEN';
      const resourceName = `customers/${account.customer_id}/campaigns/${c.google_campaign_id}`;

      if (isPmaxOrDg) {
        const rows = await googleAdsSearch({
          accessToken, customerId: account.customer_id, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
          managerCustomerId: account.manager_customer_id, gaql: assetGroupQuery(resourceName),
        });
        const parsed = rows.map((r) => parseAssetGroupRow(r, c.id)).filter((p): p is NonNullable<typeof p> => p !== null);
        totalSkipped += rows.length - parsed.length;
        const result = await upsertWithBisect(
          parsed.map((p) => ({ ...p, last_synced_at: syncedAt })),
          (b) => sb.upsert('ad_groups', b, { onConflict: 'campaign_id,google_ad_group_id' }),
          (skipped) => log.warn('upsert_row_skipped', { table: 'ad_groups', google_ad_group_id: skipped.google_ad_group_id })
        );
        totalOk += result.ok;
        totalSkipped += result.skipped;
      } else {
        const rows = await googleAdsSearch({
          accessToken, customerId: account.customer_id, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
          managerCustomerId: account.manager_customer_id, gaql: adGroupQuery(resourceName),
        });
        const parsed = rows.map((r) => parseAdGroupRow(r, c.id)).filter((p): p is NonNullable<typeof p> => p !== null);
        totalSkipped += rows.length - parsed.length;
        const result = await upsertWithBisect(
          parsed.map((p) => ({ ...p, last_synced_at: syncedAt })),
          (b) => sb.upsert('ad_groups', b, { onConflict: 'campaign_id,google_ad_group_id' }),
          (skipped) => log.warn('upsert_row_skipped', { table: 'ad_groups', google_ad_group_id: skipped.google_ad_group_id })
        );
        totalOk += result.ok;
        totalSkipped += result.skipped;
      }
    }));
    processed += batch.length;
    if (processed % 10 === 0) checkBudget('mid_ad_groups');
  }
  return { ok: totalOk, skipped: totalSkipped };
}

async function syncAds(
  env: Env, sb: ReturnType<typeof createSupabaseClient>, account: GoogleAdsAccountRow,
  accessToken: string, adGroups: Array<{ id: string; google_ad_group_id: string; entity_type: string }>,
  log: ReturnType<typeof createStructuredLogger>, syncedAt: string,
  checkBudget: (reason: string) => void
): Promise<{ ok: number; skipped: number }> {
  const targetAdGroups = adGroups.filter((ag) => ag.entity_type === 'AD_GROUP');
  let totalOk = 0;
  let totalSkipped = 0;
  let processed = 0;

  for (let i = 0; i < targetAdGroups.length; i += 5) {
    const batch = targetAdGroups.slice(i, i + 5);
    await Promise.all(batch.map(async (ag) => {
      const resourceName = `customers/${account.customer_id}/adGroups/${ag.google_ad_group_id}`;
      const rows = await googleAdsSearch({
        accessToken, customerId: account.customer_id, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
        managerCustomerId: account.manager_customer_id, gaql: adQuery(resourceName),
      });
      const parsed = rows.map((r) => parseAdRow(r, ag.id)).filter((p): p is NonNullable<typeof p> => p !== null);
      totalSkipped += rows.length - parsed.length;
      const result = await upsertWithBisect(
        parsed.map((p) => ({ ...p, last_synced_at: syncedAt })),
        (b) => sb.upsert('ads', b, { onConflict: 'ad_group_id,google_ad_id' }),
        (skipped) => log.warn('upsert_row_skipped', { table: 'ads', google_ad_id: skipped.google_ad_id })
      );
      totalOk += result.ok;
      totalSkipped += result.skipped;
    }));
    processed += batch.length;
    if (processed % 50 === 0) checkBudget('mid_ads');
  }
  return { ok: totalOk, skipped: totalSkipped };
}
