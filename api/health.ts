export async function GET(): Promise<Response> {
  const checks: Record<string, string> = {};

  const probe = async (name: string, load: () => Promise<unknown>): Promise<void> => {
    try {
      await load();
      checks[name] = 'ok';
    } catch (error) {
      checks[name] = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  await probe('catalog-data', () => import('../data/generated/catalog-data'));
  await probe('core-catalog', () => import('../src/core/catalog'));
  await probe('intent-fallback', () => import('../src/core/intent/fallback'));
  await probe('zod', () => import('zod'));
  await probe('fuse', () => import('fuse.js'));

  return Response.json({ ok: true, runtime: 'node', checks });
}
