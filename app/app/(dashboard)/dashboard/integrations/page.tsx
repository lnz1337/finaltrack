import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { ConnectButton } from './connect-button';
import { IntegrationActions } from './integration-actions';
import { formatCustomerId } from '@/lib/google-ads/customer-id';
import { getOAuthMessage } from '@/lib/google-ads/oauth-error-messages';

interface AccountRow {
  id: string;
  customer_id: string;
  account_name: string | null;
  is_active: boolean;
  last_synced_at: string | null;
}

interface SyncLogSummary {
  google_ads_account_id: string;
  status: 'success' | 'partial' | 'failed';
  rows_synced: number | null;
  duration_ms: number | null;
  partial_skipped: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string;
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id);
  const workspaceId = workspaces?.[0]?.id;
  if (!workspaceId) {
    return <p className="text-sm text-muted-foreground">Nenhuma workspace encontrada pra este usuário.</p>;
  }

  const { data: accounts } = await supabase
    .from('google_ads_accounts')
    .select('id, customer_id, account_name, is_active, last_synced_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .returns<AccountRow[]>();

  const accountIds = (accounts ?? []).map((a) => a.id);
  let lastSyncs: Record<string, SyncLogSummary> = {};
  if (accountIds.length > 0) {
    const { data: logs } = await supabase
      .from('google_ads_sync_log')
      .select('google_ads_account_id, status, rows_synced, duration_ms, partial_skipped, error_message, started_at')
      .in('google_ads_account_id', accountIds)
      .eq('sync_type', 'metadata')
      .order('started_at', { ascending: false })
      .returns<SyncLogSummary[]>();
    if (logs) {
      for (const log of logs) {
        if (!lastSyncs[log.google_ads_account_id]) lastSyncs[log.google_ads_account_id] = log;
      }
    }
  }

  const toastMsg = getOAuthMessage(
    (params.status as Parameters<typeof getOAuthMessage>[0]) ?? 'connected',
    params.reason
  );

  return (
    <div className="space-y-4 max-w-4xl">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Integrações</h1>
        {(accounts?.length ?? 0) > 0 && (
          <ConnectButton workspaceId={workspaceId} variant="outline" label="+ Conectar outra" />
        )}
      </header>

      {toastMsg && params.status && (
        <div className="text-sm rounded border px-3 py-2 bg-muted">
          {toastMsg}
        </div>
      )}

      {(accounts?.length ?? 0) === 0 ? (
        <Card className="p-6 text-center space-y-3">
          <p className="text-sm">Nenhuma conta Google Ads conectada.</p>
          <ConnectButton workspaceId={workspaceId} />
          <p className="text-xs text-muted-foreground">
            Após conectar, sincronizamos campaigns/ad_groups/ads diariamente às 03:00 UTC.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts!.map((acc) => {
            const lastSync = lastSyncs[acc.id];
            const badge = !acc.is_active
              ? { text: '⚠ Reconectar', className: 'text-amber-600' }
              : lastSync?.status === 'failed'
              ? { text: '✗ Erro temporário', className: 'text-red-600' }
              : { text: '● Conectada', className: 'text-emerald-600' };

            return (
              <Card key={acc.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{acc.account_name ?? 'Conta Google Ads'}</p>
                    <p className="text-xs text-muted-foreground">Customer ID: {formatCustomerId(acc.customer_id)}</p>
                  </div>
                  <span className={`text-xs ${badge.className}`}>{badge.text}</span>
                </div>
                {lastSync && (
                  <p className="text-xs text-muted-foreground">
                    Última sync: {new Date(lastSync.started_at).toLocaleString('pt-BR')} ({lastSync.status} · {lastSync.rows_synced ?? 0} rows · {Math.round((lastSync.duration_ms ?? 0) / 100) / 10}s)
                  </p>
                )}
                {acc.is_active ? (
                  <IntegrationActions accountId={acc.id} customerIdRaw={acc.customer_id} />
                ) : (
                  <ConnectButton workspaceId={workspaceId} variant="outline" label="Reconectar" />
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
