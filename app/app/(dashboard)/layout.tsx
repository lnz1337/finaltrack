import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold">LeoTracker</Link>
          <nav className="text-sm flex gap-4">
            <Link href="/dashboard">Resumo</Link>
            <Link href="/dashboard/conversions">Conversões</Link>
          </nav>
        </div>
        <span className="text-xs text-muted-foreground">{user.email}</span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
