import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SelectForm } from './select-form';

export default async function SelectAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const params = await searchParams;
  const sessionId = params.session;
  if (!sessionId) redirect('/dashboard/integrations');

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workerBase = process.env.WORKER_BASE_URL ?? 'http://localhost:8787';
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) redirect('/login');

  const previewRes = await fetch(`${workerBase}/oauth/google-ads/session/${sessionId}/preview`, {
    headers: {
      Authorization: `Bearer ${process.env.WORKER_INTERNAL_TOKEN ?? ''}`,
      'X-User-JWT': session.access_token,
    },
    cache: 'no-store',
  });

  if (previewRes.status === 404 || previewRes.status === 410) {
    redirect('/dashboard/integrations?status=session_expired');
  }
  if (!previewRes.ok) {
    return <p className="text-sm text-red-600">Erro ao carregar sessão de seleção ({previewRes.status}).</p>;
  }

  const preview = (await previewRes.json()) as { session_id: string; customer_ids: string[]; expires_at: string };

  return (
    <div className="space-y-4 max-w-md">
      <h1 className="text-xl font-semibold">Conexão Google Ads</h1>
      <p className="text-sm">
        Sua conta Google autoriza várias contas Google Ads. Escolha quais conectar ao LeoTracker:
      </p>
      <SelectForm
        sessionId={preview.session_id}
        customerIds={preview.customer_ids}
        expiresAt={preview.expires_at}
      />
    </div>
  );
}
