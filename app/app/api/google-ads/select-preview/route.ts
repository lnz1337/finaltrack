import { type NextRequest } from 'next/server';

// STUB Phase 5 — substituído por proxy real na Phase 7
// Retorna 2 customer_ids fake pra testar UI
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.pathname.split('/').pop();
  return Response.json({
    session_id: sessionId,
    customer_ids: ['1234567890', '9876543210'],
    expires_at: new Date(Date.now() + 9 * 60_000).toISOString(),
  });
}
