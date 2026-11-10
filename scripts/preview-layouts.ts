import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { parseCatalog } from '../src/core/catalog';
import { exportScene } from '../src/core/export/svg';
import { layout } from '../src/core/layout/layout';
import type { LayoutData, LayoutItemRequest } from '../src/core/layout/types';
import type { FormatId, FragmentPath, SubstrateVariant } from '../src/core/types';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(projectRoot, 'data', 'generated');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(generated, file), 'utf8')) as T;
}

const catalog = parseCatalog(readJson<unknown>('catalog.json'));
const layouts: LayoutData = {
  templates: readJson<{ templates: LayoutData['templates'] }>('templates.json').templates,
  relations: readJson<{ relations: LayoutData['relations'] }>('relations.json').relations,
  stats: readJson<LayoutData['stats']>('stats.json'),
};
const substrates: SubstrateVariant[] = [
  readJson<SubstrateVariant>('substrates/confetti.json'),
  readJson<SubstrateVariant>('substrates/diagonal.json'),
];
const fragments = new Map<string, FragmentPath[]>();
for (const object of catalog.objects) {
  for (const variant of object.variants) {
    fragments.set(
      variant.key,
      JSON.parse(readFileSync(path.join(generated, variant.file), 'utf8')) as FragmentPath[],
    );
  }
}

const sets: { label: string; items: LayoutItemRequest[] }[] = [
  { label: '01-book-phone', items: [{ objectId: 'book' }, { objectId: 'phone' }] },
  {
    label: '02-lamp-wallet-coin',
    items: [{ objectId: 'lamp' }, { objectId: 'wallet' }, { objectId: 'coin' }],
  },
  {
    label: '03-pen-book-puzzle',
    items: [{ objectId: 'pen' }, { objectId: 'book' }, { objectId: 'puzzle' }],
  },
  {
    label: '04-folder-wallet-coin',
    items: [{ objectId: 'folder' }, { objectId: 'wallet' }, { objectId: 'coin' }],
  },
  { label: '05-phone-puzzle', items: [{ objectId: 'phone' }, { objectId: 'puzzle' }] },
  { label: '06-headphones-tulips', items: [{ objectId: 'headphones' }, { objectId: 'tulips' }] },
  {
    label: '07-book-lamp-pen',
    items: [{ objectId: 'book' }, { objectId: 'lamp' }, { objectId: 'pen' }],
  },
  {
    label: '08-phone-wallet-folder',
    items: [{ objectId: 'phone' }, { objectId: 'wallet' }, { objectId: 'folder' }],
  },
  {
    label: '09-tulips-puzzle-coin',
    items: [{ objectId: 'tulips' }, { objectId: 'puzzle' }, { objectId: 'coin' }],
  },
  {
    label: '10-six-objects',
    items: [
      { objectId: 'book' },
      { objectId: 'phone' },
      { objectId: 'puzzle' },
      { objectId: 'coin' },
      { objectId: 'headphones' },
      { objectId: 'lamp' },
    ],
  },
];

const tempDir = path.join(projectRoot, '.tmp-layout-preview');
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });
mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });

for (const format of ['square', 'wide', 'tall'] as FormatId[]) {
  const files: string[] = [];
  sets.forEach((set, index) => {
    const scene = layout(
      {
        items: set.items,
        format,
        size: 'L',
        seed: 3 + index,
        backdrop: 'auto',
        paletteId: 'purple',
        substrate: 'diagonal',
      },
      catalog,
      layouts,
    );
    const svg = exportScene(scene, { catalog, fragments, substrates });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 360 } }).render().asPng();
    const file = path.join(tempDir, `${format}-${set.label}.png`);
    writeFileSync(file, png);
    files.push(file);
  });
  const output = path.join(projectRoot, 'docs', `layout-preview-${format}.png`);
  const geometry =
    format === 'square' ? '380x380+10+10' : format === 'wide' ? '400x230+10+10' : '290x420+10+10';
  execFileSync('montage', [
    '-background',
    '#0f1013',
    '-tile',
    '5x2',
    '-geometry',
    geometry,
    ...files,
    output,
  ]);
  console.log(`wrote ${output}`);
}

rmSync(tempDir, { recursive: true, force: true });
