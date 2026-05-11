import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ConnectButton } from '../integrations/connect-button';
import { IncludeRemovedToggle } from './_components/include-removed-toggle';

interface CampaignRow {
  id: string;
  name: string;
  campaign_type: string | null;
  status: string;
  google_ads_account_id: string;
}

interface AdGroupRow {
  id: string;
  campaign_id: string;
  name: string;
  status: string;
  entity_type: 'AD_GROUP' | 'ASSET_GROUP';
}

interface AdRow {
  id: string;
  ad_group_id: string;
  name: string | null;
  ad_type: string | null;
  status: string;
}

interface AccountRow {
  id: string;
  account_name: string | null;
  customer_id: string;
}

const ROW_LIMIT = 1000;

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ include_removed?: string }>;
}) {
  const params = await searchParams;
  const includeRemoved = params.include_removed === '1';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: workspaces } = await supabase.from('workspaces').select('id').eq('owner_id', user.id);
  const workspaceId = workspaces?.[0]?.id;
  if (!workspaceId) return <p>Sem workspace.</p>;

  const { data: accounts } = await supabase
    .from('google_ads_accounts')
    .select('id, account_name, customer_id')
    .eq('workspace_id', workspaceId)
    .returns<AccountRow[]>();

  if (!accounts || accounts.length === 0) {
    return (
      <Card className="p-6 text-center space-y-3 max-w-md mx-auto">
        <p className="text-sm">Você ainda não conectou uma conta Google Ads.</p>
        <p className="text-xs text-muted-foreground">
          Quando conectar, suas campanhas, ad groups e ads vão aparecer aqui sincronizados diariamente.
        </p>
        <ConnectButton workspaceId={workspaceId} />
      </Card>
    );
  }

  const accountIds = accounts.map((a) => a.id);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  let campaignQuery = supabase
    .from('campaigns')
    .select('id,name,campaign_type,status,google_ads_account_id')
    .in('google_ads_account_id', accountIds);
  if (!includeRemoved) campaignQuery = campaignQuery.neq('status', 'REMOVED');
  const { data: campaigns } = await campaignQuery.returns<CampaignRow[]>();
  const campaignIds = (campaigns ?? []).map((c) => c.id);
  const campaignById = new Map((campaigns ?? []).map((c) => [c.id, c]));

  let agQuery = supabase
    .from('ad_groups')
    .select('id,campaign_id,name,status,entity_type')
    .in('campaign_id', campaignIds);
  if (!includeRemoved) agQuery = agQuery.neq('status', 'REMOVED');
  const { data: adGroups } = await agQuery.returns<AdGroupRow[]>();
  const adGroupIds = (adGroups ?? []).map((a) => a.id);
  const adGroupById = new Map((adGroups ?? []).map((a) => [a.id, a]));

  let adsQuery = supabase
    .from('ads')
    .select('id,ad_group_id,name,ad_type,status')
    .in('ad_group_id', adGroupIds);
  if (!includeRemoved) adsQuery = adsQuery.neq('status', 'REMOVED');
  const { data: ads } = await adsQuery.returns<AdRow[]>();

  type FlatRow = {
    accountName: string;
    accountIdShort: string;
    campaignType: string | null;
    campaignName: string;
    campaignStatus: string;
    adGroupName: string;
    adGroupStatus: string;
    adName: string | null;
    adStatus: string | null;
  };
  const flat: FlatRow[] = [];
  const adsByAdGroup = new Map<string, AdRow[]>();
  for (const ad of ads ?? []) {
    const arr = adsByAdGroup.get(ad.ad_group_id) ?? [];
    arr.push(ad);
    adsByAdGroup.set(ad.ad_group_id, arr);
  }

  for (const ag of adGroups ?? []) {
    const c = campaignById.get(ag.campaign_id);
    if (!c) continue;
    const acc = accountById.get(c.google_ads_account_id);
    if (!acc) continue;
    const accountName = acc.account_name ?? acc.customer_id;
    const accountIdShort = acc.customer_id.slice(-4);

    const adsForAg = adsByAdGroup.get(ag.id) ?? [];
    if (adsForAg.length === 0 || ag.entity_type === 'ASSET_GROUP') {
      flat.push({
        accountName, accountIdShort, campaignType: c.campaign_type, campaignName: c.name,
        campaignStatus: c.status, adGroupName: ag.name, adGroupStatus: ag.status,
        adName: '—', adStatus: ag.status,
      });
    } else {
      for (const ad of adsForAg) {
        flat.push({
          accountName, accountIdShort, campaignType: c.campaign_type, campaignName: c.name,
          campaignStatus: c.status, adGroupName: ag.name, adGroupStatus: ag.status,
          adName: ad.name ?? `(${ad.ad_type ?? 'ad'})`, adStatus: ad.status,
        });
      }
    }
  }

  const overflowed = flat.length > ROW_LIMIT;
  const visible = flat.slice(0, ROW_LIMIT);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Campanhas</h1>
        <IncludeRemovedToggle active={includeRemoved} />
      </header>

      {overflowed && (
        <p className="text-xs text-amber-600">
          Mostrando primeiros {ROW_LIMIT} de {flat.length} resultados. Filtros virão na Fase 2B.
        </p>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Campanha</TableHead>
              <TableHead>Ad Group</TableHead>
              <TableHead>Ad</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row, i) => {
              const isRemoved = row.adStatus === 'REMOVED' || row.campaignStatus === 'REMOVED' || row.adGroupStatus === 'REMOVED';
              return (
                <TableRow key={i} className={isRemoved ? 'text-muted-foreground' : ''}>
                  <TableCell>{row.accountName}</TableCell>
                  <TableCell className="text-xs">{row.campaignType ?? '—'}</TableCell>
                  <TableCell>{row.campaignName}</TableCell>
                  <TableCell>{row.adGroupName}</TableCell>
                  <TableCell>{row.adName}</TableCell>
                  <TableCell className="text-xs">{row.adStatus}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">{flat.length} rows</p>
    </div>
  );
}
