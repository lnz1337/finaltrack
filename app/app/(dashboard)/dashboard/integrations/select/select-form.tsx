'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatCustomerId } from '@/lib/google-ads/customer-id';

interface SelectFormProps {
  sessionId: string;
  customerIds: string[];
  expiresAt: string;
}

export function SelectForm({ sessionId, customerIds, expiresAt }: SelectFormProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));

  useEffect(() => {
    const i = setInterval(() => {
      const r = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemainingMs(r);
      if (r === 0) {
        router.push('/dashboard/integrations?status=session_expired');
      }
    }, 1000);
    return () => clearInterval(i);
  }, [expiresAt, router]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/google-ads/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_uuid: sessionId, customer_ids: Array.from(selected) }),
      });
      if (res.ok) {
        router.push('/dashboard/integrations?status=connected');
      } else {
        const body = await res.text();
        alert(`Falha ao conectar: ${res.status} ${body}`);
        setSubmitting(false);
      }
    } catch (e) {
      alert('Erro ao conectar.');
      setSubmitting(false);
    }
  }

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000).toString().padStart(2, '0');

  return (
    <div className="space-y-4 max-w-md">
      <div className="space-y-2">
        {customerIds.map((id) => (
          <label key={id} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.has(id)}
              onChange={() => toggle(id)}
              className="size-4"
            />
            <span className="font-mono">{formatCustomerId(id)}</span>
          </label>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Você pode renomear cada conta depois nas configurações.
      </p>
      <p className="text-xs text-muted-foreground">
        Sessão expira em {minutes}:{seconds}
      </p>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={selected.size === 0 || submitting}>
          {submitting ? 'Conectando...' : 'Conectar selecionadas'}
        </Button>
        <Button variant="outline" asChild>
          <a href="/dashboard/integrations">Cancelar</a>
        </Button>
      </div>
    </div>
  );
}
