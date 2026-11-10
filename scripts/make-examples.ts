import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { parseCatalog } from '../src/core/catalog';
import { lintExport } from '../src/core/export/lint';
import { exportScene } from '../src/core/export/svg';
import { FORMATS } from '../src/core/layout/formats';
import type { TemplateData } from '../src/core/layout/types';
import type { FragmentPath, Instance, Scene, SubstrateVariant } from '../src/core/types';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(projectRoot, 'data', 'generated');
const examplesDir = path.join(projectRoot, 'examples');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(generated, file), 'utf8')) as T;
}

const catalog = parseCatalog(readJson<unknown>('catalog.json'));
const templates = readJson<{ templates: TemplateData[] }>('templates.json').templates;
const substrates: SubstrateVariant[] = [
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

interface ExampleSpec {
  templateId: string;
  file: string;
  paletteId: string;
}

const specs: ExampleSpec[] = [
  { templateId: 'scene-1-square', file: '01-learning-square', paletteId: 'purple' },
  { templateId: 'scene-2-wide', file: '02-finance-wide', paletteId: 'orange' },
  { templateId: 'scene-6-tall', file: '03-focus-tall', paletteId: 'teal' },
];

mkdirSync(examplesDir, { recursive: true });

for (const spec of specs) {
  const template = templates.find((candidate) => candidate.id === spec.templateId);
  if (!template) throw new Error(`Template not found: ${spec.templateId}`);
  const scene: Scene = {
    version: 1,
    format: template.format,
    size: 'L',
    paletteId: spec.paletteId,
    substrate: template.substrate,
    scale: 1,
    items: template.items.map((item, index): Instance => ({
      id: `example-${index}-${item.objectId}`,
      objectId: item.objectId,
      state: item.state,
      x: item.x,
      y: item.y,
      rotation: 0,
    })),
  };
  const svg = exportScene(scene, { catalog, fragments, substrates });
  const frame = FORMATS[template.format];
  const lint = lintExport(svg, {
    width: frame.width,
    height: frame.height,
    idPrefix: 'ic1-',
    allowedD,
  });
  if (!lint.ok) {
    throw new Error(`${spec.file}: ${lint.errors.join('; ')}`);
  }
  const svgFile = path.join(examplesDir, `${spec.file}.svg`);
  writeFileSync(svgFile, svg, 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1000 } }).render().asPng();
  writeFileSync(path.join(examplesDir, `${spec.file}.png`), png);
  console.log(`wrote ${spec.file}.svg/.png (${template.format}, ${spec.paletteId})`);
}

const readme = `# Примеры композиций

| Файл | Сцена | Формат | Схема |
|---|---|---|---|
| 01-learning-square | Книга + телефон | 1000×1000 | purple |
| 02-finance-wide | Лампа + кошелёк + монета | 1200×630 | orange |
| 03-focus-tall | Тюльпаны + наушники | 800×1200 | teal |

SVG экспортированы из редактора тем же сериализатором, что и кнопка «Скачать SVG».
Они содержат исходные \`d\` путей без изменений, слои объектов с префиксом \`ic1-\`,
подложку и фон в hex-цветах палитры.
`;
writeFileSync(path.join(examplesDir, 'README.md'), readme, 'utf8');
