'use client';

import { Button } from '@/components/ui/button';

interface ConnectButtonProps {
  workspaceId: string;
  variant?: 'default' | 'outline';
  label?: string;
}

export function ConnectButton({ workspaceId, variant = 'default', label = 'Conectar Google Ads' }: ConnectButtonProps) {
  const workerBase = process.env.NEXT_PUBLIC_WORKER_BASE_URL ?? 'http://localhost:8787';
  const href = `${workerBase}/oauth/google-ads/start?workspace_id=${encodeURIComponent(workspaceId)}`;
  return (
    <Button asChild variant={variant}>
      <a href={href}>{label}</a>
    </Button>
  );
}
