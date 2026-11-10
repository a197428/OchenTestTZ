/**
 * Metaphor -> object picks (Scenario 1).
 *
 * Phase 6: validate input with zod, rate-limit per IP, call the Claude API with
 * the catalog as data, validate the JSON answer, fall back to the local matcher.
 * The API key must stay on the server.
 */
export default async function handler(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not_implemented', phase: 6 }), {
    status: 501,
    headers: { 'content-type': 'application/json' },
  });
}
