import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves the serverless compose-intent function during `pnpm dev`.
 * The key stays in the Node process; the client only sees /api/compose-intent.
 */
function localApi(): Plugin {
  return {
    name: 'local-compose-intent',
    configureServer(server) {
      server.middlewares.use('/api/compose-intent', (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          void (async () => {
            try {
              const module = (await server.ssrLoadModule('/src/server/compose-intent.ts')) as {
                POST: (request: Request) => Promise<Response>;
              };
              const headers = new Headers();
              for (const [name, value] of Object.entries(request.headers)) {
                if (typeof value === 'string') headers.set(name, value);
                else if (Array.isArray(value)) headers.set(name, value.join(','));
              }
              const apiRequest = new Request(
                `http://localhost${request.url ?? '/api/compose-intent'}`,
                {
                  method: 'POST',
                  headers,
                  body: Buffer.concat(chunks).toString('utf8'),
                },
              );
              const apiResponse = await module.POST(apiRequest);
              response.statusCode = apiResponse.status;
              apiResponse.headers.forEach((value, name) => response.setHeader(name, value));
              response.end(Buffer.from(await apiResponse.arrayBuffer()));
            } catch (error) {
              response.statusCode = 500;
              response.setHeader('content-type', 'application/json; charset=utf-8');
              response.end(
                JSON.stringify({
                  error: 'dev_api_failed',
                  message: error instanceof Error ? error.message : String(error),
                }),
              );
            }
          })();
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of [
    'ROUTERAI_API_KEY',
    'ROUTERAI_BASE_URL',
    'ROUTERAI_MODEL',
    'COMPOSE_RATE_LIMIT_PER_HOUR',
  ]) {
    if (env[key] !== undefined) process.env[key] = env[key];
  }
  return {
    plugins: [react(), localApi()],
  };
});
