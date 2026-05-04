'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Entrar no LeoTracker</CardTitle>
        </CardHeader>
        <CardContent>
          {status === 'sent' ? (
            <p className="text-sm">Link mágico enviado pra <strong>{email}</strong>. Cheque sua caixa de entrada.</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                />
              </div>
              <Button type="submit" className="w-full" disabled={status === 'sending'}>
                {status === 'sending' ? 'Enviando...' : 'Enviar link mágico'}
              </Button>
              {errorMsg && <p className="text-sm text-red-500">{errorMsg}</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
