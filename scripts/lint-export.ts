import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog } from '../src/core/catalog';
import { lintExport } from '../src/core/export/lint';
import { exportScene } from '../src/core/export/svg';
import { FORMATS } from '../src/core/layout/formats';
import { createScene } from '../src/core/scene';
import type { FragmentPath, Instance, Scene, SubstrateVariant } from '../src/core/types';
import type { TemplatesFile } from './ingest/examples';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(projectRoot, 'data', 'generated');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(generated, file), 'utf8')) as T;
}

const catalog = parseCatalog(readJson<unknown>('catalog.json'));
const templates = readJson<TemplatesFile>('templates.json');
const substrates = [
  readJson<SubstrateVariant>('substrates/confetti.json'),
  readJson<SubstrateVariant>('substrates/diagonal.json'),
];

const fragments = new Map<string, FragmentPath[]>();
const allowedD = new Set<string>();
for (const object of catalog.objects) {
  for (const variant of object.variants) {
    const paths = JSON.parse(
      readFileSync(path.join(generated, variant.file), 'utf8'),
    ) as FragmentPath[];
    fragments.set(variant.key, paths);
    for (const fragment of paths) allowedD.add(fragment.d);
  }
}
for (const substrate of substrates) {
  for (const format of Object.values(substrate.byFormat)) {
    for (const element of format.elements) {
      if (element.tag === 'path' && element.d) allowedD.add(element.d);
    }
  }
}

let failures = 0;
for (const template of templates.templates) {
  const scene: Scene = {
    ...createScene(template.format, 'purple', template.substrate),
    items: template.items.map((item): Instance => ({
      id: `${item.objectId}-${item.state}`,
      objectId: item.objectId,
      state: item.state,
      x: item.x,
      y: item.y,
      rotation: 0,
    })),
  };
  const frame = FORMATS[template.format];
  let svg: string;
  try {
    svg = exportScene(scene, { catalog, fragments, substrates });
  } catch (error) {
    failures++;
    console.error(`FAIL ${template.id}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  const result = lintExport(svg, {
    width: frame.width,
    height: frame.height,
    allowedD,
    idPrefix: 'ic1-',
  });
  if (!result.ok) {
    failures++;
    console.error(`FAIL ${template.id}:`);
    for (const error of result.errors.slice(0, 8)) console.error(`  - ${error}`);
  }
}

if (failures > 0) {
  console.error(`[lint:export] ${failures} template exports failed`);
  process.exitCode = 1;
} else {
  console.log(`[lint:export] ${templates.templates.length} example exports are valid`);
}
