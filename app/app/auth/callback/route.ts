import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  // Origin canônico (não confia em request.url, que pode normalizar 127.0.0.1 -> localhost)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(siteUrl + next);
    }
  }
  return NextResponse.redirect(siteUrl + '/login?error=auth_callback_failed');
}
