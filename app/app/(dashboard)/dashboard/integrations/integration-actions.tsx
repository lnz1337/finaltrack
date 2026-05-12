'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDestructive } from '@/components/confirm-destructive';
import { formatCustomerId } from '@/lib/google-ads/customer-id';
import { useSyncStatus } from '@/lib/google-ads/sync-polling';

interface IntegrationActionsProps {
  accountId: string;
  customerIdRaw: string;
}

export function IntegrationActions({ accountId, customerIdRaw }: IntegrationActionsProps) {
  const router = useRouter();
  const [syncTriggered, setSyncTriggered] = useState(false);
  const [pendingAction, startTransition] = useTransition();
  const { status, isPolling, timedOut } = useSyncStatus(accountId, syncTriggered);

  async function triggerSync() {
    const res = await fetch('/api/google-ads/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ google_ads_account_id: accountId }),
    });
    if (!res.ok) {
      alert(`Falha ao iniciar sync: ${res.status}`);
      return;
    }
    setSyncTriggered(true);
  }

  async function disconnect() {
    const res = await fetch('/api/google-ads/disconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ google_ads_account_id: accountId }),
    });
    if (res.ok) {
      startTransition(() => router.refresh());
    } else {
      alert(`Falha ao desconectar: ${res.status}`);
    }
  }

  if (syncTriggered && status && status.status !== 'running') {
    if (!isPolling) {
      setTimeout(() => router.refresh(), 0);
    }
  }

  return (
    <div className="flex gap-2 items-center">
      <Button
        variant="outline" size="sm"
        onClick={triggerSync}
        disabled={isPolling || pendingAction}
      >
        {isPolling ? 'Sincronizando...' : timedOut ? 'Sync demorando…' : 'Sincronizar agora'}
      </Button>
      <ConfirmDestructive
        trigger={<Button variant="outline" size="sm">Desconectar</Button>}
        title={`Desconectar conta ${formatCustomerId(customerIdRaw)}?`}
        description={
          <>
            Sync diário vai parar. Histórico de campaigns, ad_groups, ads e logs fica
            preservado — você pode reconectar a qualquer momento sem perder dados.
          </>
        }
        actionLabel="Desconectar"
        onConfirm={disconnect}
      />
    </div>
  );
}
