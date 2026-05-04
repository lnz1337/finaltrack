export function handleHealth(): Response {
  return Response.json({ ok: true, ts: new Date().toISOString() });
}
