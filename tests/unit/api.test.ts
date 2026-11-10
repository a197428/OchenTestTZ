import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseIntent, validateIntent } from '../../src/core/intent/schema';
import { loadCatalog } from '../helpers/assets';

const catalog = loadCatalog();
let handler: (request: Request) => Promise<Response>;
let previousKey: string | undefined;

beforeAll(async () => {
  previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const module = await import('../../api/compose-intent');
  handler = module.default;
});

afterAll(() => {
  if (previousKey !== undefined) {
    process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

function post(text: unknown, ip = 'test-ip'): Request {
  return new Request('http://localhost/api/compose-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ text, locale: 'ru' }),
  });
}

describe('compose-intent API', () => {
  it('rejects non-POST requests', async () => {
    const response = await handler(
      new Request('http://localhost/api/compose-intent', { method: 'GET' }),
    );
    expect(response.status).toBe(405);
  });

  it('rejects invalid text', async () => {
    expect((await handler(post(''))).status).toBe(400);
    expect((await handler(post('x'.repeat(201)))).status).toBe(400);
  });

  it('falls back locally without an API key', async () => {
    const response = await handler(post('обучение', 'fallback-ip'));
    expect(response.status).toBe(200);
    const intent = parseIntent(await response.json());
    expect(validateIntent(intent, catalog).errors).toEqual([]);
    expect(intent.picks.some((pick) => pick.objectId === 'book')).toBe(true);
  });

  it('serves repeated text from the cache', async () => {
    const first = await handler(post('деньги', 'cache-ip'));
    const second = await handler(post('деньги', 'cache-ip'));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
  });
});
