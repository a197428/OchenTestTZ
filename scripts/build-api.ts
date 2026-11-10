import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(projectRoot, 'api', 'compose-intent.js');
const check = process.argv.includes('--check');

const result = await build({
  absWorkingDir: projectRoot,
  entryPoints: ['src/server/compose-intent.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'warning',
  write: false,
});

const output = result.outputFiles?.[0]?.text;
if (!output) {
  throw new Error('esbuild produced no output');
}

if (check) {
  let current: string;
  try {
    current = readFileSync(outfile, 'utf8');
  } catch {
    current = '';
  }
  if (current !== output) {
    console.error('[build:api] api/compose-intent.js is stale. Run pnpm build:api.');
    process.exitCode = 1;
  } else {
    console.log('[build:api] bundle is current');
  }
} else {
  writeFileSync(outfile, output, 'utf8');
  console.log(`[build:api] wrote ${path.relative(projectRoot, outfile)} (${output.length} bytes)`);
}
