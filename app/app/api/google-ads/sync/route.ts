// STUB Phase 5 — substituído por proxy real na Phase 7
export async function POST() {
  return Response.json({
    log_id: 'stub-log',
    status: 'running',
    started_at: new Date().toISOString(),
  });
}
