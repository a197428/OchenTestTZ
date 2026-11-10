import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Element } from '@xmldom/xmldom';
import type { FormatId } from '../src/core/types';
import { loadCurated, type PaletteScheme } from './ingest/curated';
import { buildExamples } from './ingest/examples';
import { buildLibrary } from './ingest/library';
import { buildSubstrates, substrateTealOracle } from './ingest/substrates';
import { childElements, elementId, findSheetRoot, parseSvg } from './ingest/svg';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const curated = loadCurated(projectRoot);

interface Fact {
  name: string;
  ok: boolean;
  detail: string;
}

const facts: Fact[] = [];

function check(name: string, ok: boolean, detail: string): void {
  facts.push({ name, ok, detail });
}

function collectByTag(node: Element, tag: string, out: Element[] = []): Element[] {
  if (node.tagName === tag) out.push(node);
  for (const child of childElements(node)) collectByTag(child, tag, out);
  return out;
}

function normalizeColor(value: string | null): string {
  if (!value) return '';
  if (value.toLowerCase() === 'white') return '#FFFFFF';
  return value.toUpperCase();
}

function schemeSet(scheme: PaletteScheme): Set<string> {
  return new Set(Object.values(scheme.slots).map((value) => normalizeColor(value)));
}

// A. Library path counts and generated variants.
const library = buildLibrary(projectRoot, curated);
const diagnosticsByKey = new Map(
  library.diagnostics.map((item) => [`${item.objectId}.${item.state}`, item]),
);

let pathCountFailures = 0;
for (const entry of curated.figmaMap.objects) {
  for (const state of ['main', 'bg'] as const) {
    for (const size of ['L', 'S'] as const) {
      const expected = entry.expectedPaths[size][state];
      const key = `${entry.id}.${state}`;
      const variants = library.catalog.objects
        .find((object) => object.id === entry.id)!
        .variants.filter((variant) => variant.state === state);
      const exact = variants.find((variant) => variant.size === size);
      const alias = variants.find((variant) => variant.sizes.includes(size));
      const actual = exact?.pathCount ?? alias?.pathCount;
      if (actual === undefined || actual !== expected) {
        pathCountFailures++;
        check(`paths ${key}.${size}`, false, `expected ${expected}, got ${actual ?? 'missing'}`);
      }
    }
  }
}
check(
  'library path counts',
  pathCountFailures === 0,
  pathCountFailures === 0
    ? 'all 40 object/state/size counts match figma-map'
    : `${pathCountFailures} mismatches`,
);

check(
  'library variants',
  library.catalog.objects.length === 10 &&
    library.catalog.objects.every((object) => {
      const states = new Set(object.variants.map((variant) => variant.state));
      return states.has('main') && states.has('bg');
    }),
  `${library.catalog.objects.length} objects, ${library.fragments.size} fragments, ${library.diagnostics.filter((item) => item.kind === 'alias').length} aliases`,
);

// B. Palettes against the sheet swatches.
const sheetRoot = findSheetRoot(parseSvg(path.join(projectRoot, curated.figmaMap.sheets.L.file)));
const swatches: { id: string; fills: string[] }[] = [];
for (const child of childElements(sheetRoot)) {
  if (child.tagName !== 'g') continue;
  if (collectByTag(child, 'path').length > 0) continue;
  const rects = collectByTag(child, 'rect');
  if (rects.length !== 8) continue;
  swatches.push({
    id: elementId(child),
    fills: rects.map((rect) => normalizeColor(rect.getAttribute('fill'))),
  });
}

const swatchMatches = new Set<string>();
for (const swatch of swatches) {
  const set = new Set(swatch.fills);
  const scheme = curated.palettes.schemes.find((candidate) => {
    const expected = schemeSet(candidate);
    return expected.size === set.size && [...expected].every((value) => set.has(value));
  });
  if (scheme) swatchMatches.add(scheme.id);
}
check(
  'palette swatches',
  swatches.length === 3 && swatchMatches.size === 3,
  `${swatches.length} swatch groups, matched schemes: ${[...swatchMatches].join(', ') || 'none'}`,
);

// C. S -> L fits.
const expectedScales: Record<string, number> = {
  book: 2.0,
  phone: 2.0,
  puzzle: 2.0,
  coin: 1.881,
  headphones: 2.0,
  lamp: 2.0,
  tulips: 1.827,
  wallet: 2.0,
  pen: 2.0,
  folder: 2.0,
};

const fitFailures: string[] = [];
for (const [key, diagnostic] of diagnosticsByKey) {
  const objectId = diagnostic.objectId;
  const expected = expectedScales[objectId];
  if (expected === undefined) {
    fitFailures.push(`${key}: no expected scale`);
    continue;
  }
  if (Math.abs(diagnostic.scale - expected) > 0.002) {
    fitFailures.push(`${key}: scale ${diagnostic.scale.toFixed(4)} != ${expected}`);
  }
  if (diagnostic.rms >= 0.05) {
    fitFailures.push(`${key}: rms ${diagnostic.rms.toFixed(4)}`);
  }
}
check(
  'S -> L fits',
  fitFailures.length === 0,
  fitFailures.length === 0
    ? `all ${diagnosticsByKey.size} states fitted, max rms ${Math.max(...library.diagnostics.map((item) => item.rms)).toFixed(4)}`
    : fitFailures.join('; '),
);

const scaleSummary = [...diagnosticsByKey.values()]
  .filter((item) => item.state === 'main')
  .map((item) => `${item.objectId}=${item.scale.toFixed(4)}`)
  .join(' ');
check('scale table', true, scaleSummary);

// D. Alias expectations.
const expectedAlias = new Set([
  'book.bg',
  'phone.bg',
  'puzzle.bg',
  'coin.bg',
  'headphones.bg',
  'lamp.main',
  'lamp.bg',
  'tulips.main',
  'tulips.bg',
  'wallet.bg',
  'pen.bg',
  'folder.bg',
]);
const actualAlias = new Set(
  library.diagnostics
    .filter((item) => item.kind === 'alias')
    .map((item) => `${item.objectId}.${item.state}`),
);
const aliasDiff = [...expectedAlias].filter((key) => !actualAlias.has(key));
const unexpectedAlias = [...actualAlias].filter((key) => !expectedAlias.has(key));
check(
  'alias set',
  aliasDiff.length === 0 && unexpectedAlias.length === 0,
  `missing: ${aliasDiff.join(', ') || 'none'}; unexpected: ${unexpectedAlias.join(', ') || 'none'}`,
);

// E. Examples sheet frames.
const exampleRoot = findSheetRoot(
  parseSvg(path.join(projectRoot, 'data', 'source', 'examples', 'composition-examples.svg')),
);
const frameGroups = childElements(exampleRoot).filter(
  (child) => child.tagName === 'g' && /^Фон(_\d+)?$/.test(elementId(child)),
);
const formatCounts: Record<FormatId, number> = { square: 0, wide: 0, tall: 0 };
const frameSchemes = new Map<string, number>();
const schemeByBackground = new Map(
  curated.palettes.schemes.map((scheme) => [normalizeColor(scheme.slots['bg-light']), scheme.id]),
);

for (const frame of frameGroups) {
  const rects = collectByTag(frame, 'rect');
  const rect = rects[0];
  if (!rect) continue;
  const width = Number(rect.getAttribute('width'));
  const height = Number(rect.getAttribute('height'));
  if (width === 1000 && height === 1000) formatCounts.square++;
  else if (width === 1200 && height === 630) formatCounts.wide++;
  else if (width === 800 && height === 1200) formatCounts.tall++;
  const scheme = schemeByBackground.get(normalizeColor(rect.getAttribute('fill'))) ?? 'unknown';
  frameSchemes.set(scheme, (frameSchemes.get(scheme) ?? 0) + 1);
}
check(
  'examples frames',
  elementId(exampleRoot) === 'Section 1' &&
    frameGroups.length === 18 &&
    formatCounts.square === 6 &&
    formatCounts.wide === 6 &&
    formatCounts.tall === 6,
  `root="${elementId(exampleRoot)}", frames=${frameGroups.length}, ` +
    `square=${formatCounts.square}, wide=${formatCounts.wide}, tall=${formatCounts.tall}, ` +
    `schemes=${[...frameSchemes.entries()].map(([slot, count]) => `${slot}:${count}`).join(', ')}`,
);

// F. Substrate recoloring oracle (purple confetti -> teal vs Фон_2).
const oracle = substrateTealOracle(projectRoot, curated);
const oracleMismatches = oracle.expected
  .map((value, index) => {
    const actual = oracle.actual[index];
    if (!actual) return `#${index}: missing`;
    const near = (
      left: [number, number] | undefined,
      right: [number, number] | undefined,
    ): boolean => {
      if (!left || !right) return left === right;
      return Math.abs(left[0] - right[0]) <= 0.05 && Math.abs(left[1] - right[1]) <= 0.05;
    };
    const geometryOk = value.geometry === actual.geometry && near(value.end, actual.end);
    if (
      geometryOk &&
      value.fill === actual.fill &&
      value.stroke === actual.stroke &&
      near(value.position, actual.position)
    ) {
      return null;
    }
    return `#${index}: ${value.geometry}/${value.fill}/${value.stroke}@${value.position.join(',')} != ${actual.geometry}/${actual.fill}/${actual.stroke}@${actual.position.join(',')}`;
  })
  .filter((value): value is string => value !== null);
check(
  'substrate teal oracle',
  oracle.expected.length === oracle.actual.length && oracleMismatches.length === 0,
  `${oracle.expected.length} confetti elements -> ${oracle.actual.length} teal elements, ` +
    `mismatches=${oracleMismatches.length}${oracleMismatches.length ? ` (${oracleMismatches.join('; ')})` : ''}`,
);

// G. Background slot invariant on fragments.
let bgSlotFailures = 0;
for (const object of library.catalog.objects) {
  for (const variant of object.variants) {
    if (variant.state !== 'bg') continue;
    const fragments = library.fragments.get(variant.key) ?? [];
    for (const fragment of fragments) {
      for (const slot of [fragment.fill, fragment.stroke]) {
        if (slot && !['bg-light', 'bg-mid', 'bg-dark'].includes(slot)) bgSlotFailures++;
      }
    }
  }
}
check(
  'background slot invariant',
  bgSlotFailures === 0,
  bgSlotFailures === 0 ? 'all bg fragments use only bg-* slots' : `${bgSlotFailures} violations`,
);

// H. Expected fit diagnostics count.
const fitStateCount = library.diagnostics.length;
check(
  'fit diagnostics',
  fitStateCount === 20,
  `${fitStateCount} object/state pairs checked (expected 20)`,
);

// I. Generated files are up to date and complete.
const generatedDir = path.join(projectRoot, 'data', 'generated');
const catalogPath = path.join(generatedDir, 'catalog.json');
const catalogRaw = readFileSync(catalogPath, 'utf8');
const expectedCatalog = `${JSON.stringify(library.catalog, null, 2)}\n`;
const expectedCatalogData = `// AUTO-GENERATED by pnpm ingest. Do not edit.\nexport const catalogData: unknown = ${expectedCatalog.trimEnd()};\n`;
let generatedProblems = 0;
if (catalogRaw !== expectedCatalog) generatedProblems++;
try {
  if (readFileSync(path.join(generatedDir, 'catalog-data.ts'), 'utf8') !== expectedCatalogData) {
    generatedProblems++;
  }
} catch {
  generatedProblems++;
}

const fragmentFiles = readdirSync(path.join(generatedDir, 'fragments')).filter((file) =>
  file.endsWith('.json'),
);
if (fragmentFiles.length !== library.fragments.size) generatedProblems++;
for (const [key, paths] of library.fragments) {
  const file = path.join(generatedDir, 'fragments', `${key}.json`);
  const expected = `${JSON.stringify(paths, null, 2)}\n`;
  try {
    if (readFileSync(file, 'utf8') !== expected) generatedProblems++;
  } catch {
    generatedProblems++;
  }
}
check(
  'generated files current',
  generatedProblems === 0,
  generatedProblems === 0
    ? `catalog and ${library.fragments.size} fragments match ingest output`
    : `${generatedProblems} stale or missing files; run pnpm ingest`,
);

// J. Example templates, relations, stats and per-format substrates.
const baseSubstrates = buildSubstrates(projectRoot, curated);
const examples = buildExamples(projectRoot, curated, library, baseSubstrates);

const sceneFormats = new Map<string, Set<string>>();
const templateFormatCounts: Record<string, number> = { square: 0, wide: 0, tall: 0 };
let itemProblems = 0;
for (const template of examples.templates) {
  templateFormatCounts[template.format] = (templateFormatCounts[template.format] ?? 0) + 1;
  const formats = sceneFormats.get(template.sceneId) ?? new Set<string>();
  formats.add(template.format);
  sceneFormats.set(template.sceneId, formats);

  if (template.items.length < 2 || template.items.length > 3) itemProblems++;
  if (new Set(template.items.map((item) => item.z)).size !== template.items.length) itemProblems++;
  for (const item of template.items) {
    const object = library.catalog.objects.find((candidate) => candidate.id === item.objectId);
    if (!object) {
      itemProblems++;
      continue;
    }
    const variant = object.variants.find(
      (candidate) => candidate.state === item.state && candidate.sizes.includes(item.size),
    );
    if (!variant) itemProblems++;
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) itemProblems++;
  }
}
check(
  'example templates',
  examples.templates.length === 18 &&
    sceneFormats.size === 6 &&
    [...sceneFormats.values()].every((formats) => formats.size === 3) &&
    templateFormatCounts.square === 6 &&
    templateFormatCounts.wide === 6 &&
    templateFormatCounts.tall === 6 &&
    itemProblems === 0,
  `${examples.templates.length} templates, ${sceneFormats.size} scenes, ` +
    `square=${templateFormatCounts.square}, wide=${templateFormatCounts.wide}, tall=${templateFormatCounts.tall}, item problems=${itemProblems}`,
);

const scaleWarnings = examples.warnings.filter((warning) => warning.startsWith('Scale '));
check(
  'example scale 1.0',
  scaleWarnings.length === 0,
  scaleWarnings.length === 0
    ? 'every matched object is placed at native scale 1.0 +/- 0.002'
    : `${scaleWarnings.length} deviations: ${scaleWarnings.slice(0, 3).join('; ')}`,
);

const matchWarnings = examples.warnings.filter((warning) => warning.startsWith('No object match'));
check(
  'example object matching',
  matchWarnings.length === 0 && examples.warnings.length === 0,
  examples.warnings.length === 0
    ? 'all object groups matched, all substrates consistent'
    : examples.warnings.slice(0, 3).join('; '),
);

const expectedRelations = [
  'headphones:main->tulips:bg',
  'phone:main->book:main',
  'puzzle:main->book:bg',
];
const actualRelations = examples.relations.relations.map(
  (relation) => `${relation.from}:${relation.fromState}->${relation.to}:${relation.toState}`,
);
check(
  'example relations',
  expectedRelations.every((key) => actualRelations.includes(key)) &&
    examples.relations.relations.every((relation) =>
      relation.offsets.every((offset) => offset.every(Number.isFinite)),
    ),
  `${examples.relations.relations.length} relations: ${actualRelations.join(', ')}`,
);

const purePermutations = examples.stats.colorPermutations.filter(
  (change) => change.pureObjPermutation,
);
check(
  'ASK-03 pure object permutations',
  purePermutations.length === 0,
  purePermutations.length === 0
    ? `none; color changes: ${examples.stats.colorPermutations.map((change) => `${change.objectId}@${change.sceneId} (${change.pairs.map(([a, b]) => `${a}>${b}`).join(', ')})`).join('; ') || 'none'}`
    : `${purePermutations.length} pure obj-slot permutations found`,
);

const substrateFormatsOk = examples.substrates.every(
  (substrate) =>
    substrate.byFormat.square.elements.length > 0 &&
    substrate.byFormat.wide.elements.length > 0 &&
    substrate.byFormat.tall.elements.length > 0 &&
    !substrate.byFormat.square.fallback &&
    !substrate.byFormat.wide.fallback &&
    !substrate.byFormat.tall.fallback,
);
check(
  'per-format substrates',
  substrateFormatsOk,
  examples.substrates
    .map(
      (substrate) =>
        `${substrate.id}: square=${substrate.byFormat.square.elements.length}, ` +
        `wide=${substrate.byFormat.wide.elements.length}, tall=${substrate.byFormat.tall.elements.length}`,
    )
    .join('; '),
);

const generatedExamplesProblems: string[] = [];
const expectedExampleFiles: [string, string][] = [
  ['templates.json', `${JSON.stringify({ version: 1, templates: examples.templates }, null, 2)}\n`],
  ['relations.json', `${JSON.stringify(examples.relations, null, 2)}\n`],
  ['stats.json', `${JSON.stringify(examples.stats, null, 2)}\n`],
  ...examples.substrates.map(
    (substrate) =>
      [`substrates/${substrate.id}.json`, `${JSON.stringify(substrate, null, 2)}\n`] as [
        string,
        string,
      ],
  ),
];
for (const [file, expected] of expectedExampleFiles) {
  try {
    if (readFileSync(path.join(generatedDir, file), 'utf8') !== expected) {
      generatedExamplesProblems.push(file);
    }
  } catch {
    generatedExamplesProblems.push(file);
  }
}
check(
  'example generated files current',
  generatedExamplesProblems.length === 0,
  generatedExamplesProblems.length === 0
    ? 'templates, relations, stats and substrates match example ingest'
    : `stale: ${generatedExamplesProblems.join(', ')}`,
);

// Print.
const width = Math.max(...facts.map((fact) => fact.name.length));
for (const fact of facts) {
  console.log(`${fact.ok ? 'OK  ' : 'FAIL'} ${fact.name.padEnd(width)}  ${fact.detail}`);
}

const failures = facts.filter((fact) => !fact.ok);
console.log(`\n${facts.length - failures.length}/${facts.length} checks passed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
