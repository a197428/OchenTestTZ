import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseIntent, validateIntent } from '../../src/core/intent/schema';
import { loadCatalog } from '../helpers/assets';

const catalog = loadCatalog();
let handler: (request: Request) => Promise<Response>;
let previousKey: string | undefined;
let previousBase: string | undefined;
let previousModel: string | undefined;

beforeAll(async () => {
  previousKey = process.env.ROUTERAI_API_KEY;
  previousBase = process.env.ROUTERAI_BASE_URL;
  previousModel = process.env.ROUTERAI_MODEL;
  delete process.env.ROUTERAI_API_KEY;
  delete process.env.ROUTERAI_BASE_URL;
  delete process.env.ROUTERAI_MODEL;
  const module = await import('../../api/compose-intent');
  handler = module.POST;
});

afterEach(() => {
  delete process.env.ROUTERAI_API_KEY;
  vi.unstubAllGlobals();
});

afterAll(() => {
  restore('ROUTERAI_API_KEY', previousKey);
  restore('ROUTERAI_BASE_URL', previousBase);
  restore('ROUTERAI_MODEL', previousModel);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function post(text: unknown, ip = 'test-ip'): Request {
  return new Request('http://localhost/api/compose-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ text, locale: 'ru' }),
  });
}

const validIntent = {
  concepts: ['обучение'],
  picks: [{ objectId: 'book', state: 'main', role: 'hero', reason: 'знания' }],
  fit: 'good',
  note: 'Книга лучше всего передаёт обучение.',
};

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
    expect(response.headers.get('x-intent-source')).toBe('fallback');
    const intent = parseIntent(await response.json());
    expect(validateIntent(intent, catalog).errors).toEqual([]);
    expect(intent.picks.some((pick) => pick.objectId === 'book')).toBe(true);
  });

  it('calls RouterAI with the configured model and validates its JSON', async () => {
    process.env.ROUTERAI_API_KEY = 'test-key';
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(validIntent) } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const response = await handler(post('обучение', 'router-ip'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-intent-source')).toBe('llm');
    expect(parseIntent(await response.json())).toEqual(validIntent);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://routerai.ru/api/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body.model).toBe('deepseek/deepseek-v4.1-flash-1017');
    delete process.env.ROUTERAI_API_KEY;
  });

  it('retries once and falls back on an invalid model answer', async () => {
    process.env.ROUTERAI_API_KEY = 'test-key';
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const response = await handler(post('деньги', 'invalid-ip'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-intent-source')).toBe('fallback');
    expect(calls).toBe(2);
    expect(validateIntent(parseIntent(await response.json()), catalog).errors).toEqual([]);
    delete process.env.ROUTERAI_API_KEY;
  });

  it('falls back when RouterAI returns an HTTP error', async () => {
    process.env.ROUTERAI_API_KEY = 'test-key';
    vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
    const response = await handler(post('идея', 'http-error-ip'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-intent-source')).toBe('fallback');
    delete process.env.ROUTERAI_API_KEY;
  });

  it('serves repeated text from the cache', async () => {
    const first = await handler(post('деньги', 'cache-ip'));
    const second = await handler(post('деньги', 'cache-ip'));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
  });
});
