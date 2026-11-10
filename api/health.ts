export function GET(): Response {
  return Response.json({ ok: true, runtime: 'node' });
}
