import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Element } from '@xmldom/xmldom';
import { BG_SLOTS } from '../../src/core/slots';
import type {
  DetailSize,
  FragmentPath,
  Matrix,
  ObjectId,
  ObjectState,
  Palette,
  Slot,
} from '../../src/core/types';
import {
  getMeta,
  getSourceScheme,
  type CuratedData,
  type FigmaObjectEntry,
  type PaletteScheme,
} from './curated';
import {
  bboxSize,
  buildHull,
  collectPaths,
  elementId,
  fitSourceToTarget,
  findSheetRoot,
  parseSvg,
  pathBBox,
  matchShapes,
  shapeSignature,
  sha1,
  transformBBox,
  type FitResult,
} from './svg';

export interface GeneratedVariant {
  key: string;
  state: ObjectState;
  size: DetailSize;
  sizes: DetailSize[];
  file: string;
  toNative: Matrix;
  bbox: { w: number; h: number };
  hull: [number, number][];
  geometryHash: string;
  pathCount: number;
  fit?: { matched: number; total: number; scale: number; rms: number };
}

export interface GeneratedObject {
  id: ObjectId;
  nameRu: string;
  nameEn: string;
  meta: { synonyms: string[]; tags: string[]; heroWeight: number };
  variants: GeneratedVariant[];
}

export interface GeneratedCatalog {
  version: 1;
  source: {
    library: Record<DetailSize, string>;
    palettes: string;
  };
  objects: GeneratedObject[];
  palettes: Palette[];
}

export interface FitDiagnostic {
  objectId: ObjectId;
  state: ObjectState;
  kind: 'alias' | 'variant';
  matched: number;
  total: number;
  scale: number;
  rms: number;
}

export interface BuiltLibrary {
  catalog: GeneratedCatalog;
  fragments: Map<string, FragmentPath[]>;
  diagnostics: FitDiagnostic[];
}

type BBox = [number, number, number, number];

const STATES: readonly ObjectState[] = ['main', 'bg'];

function hullTuples(points: readonly { x: number; y: number }[]): [number, number][] {
  return points.map((point) => [point.x, point.y]);
}

function buildSlotMap(scheme: PaletteScheme): Map<string, Slot> {
  const map = new Map<string, Slot>();
  for (const [slot, hex] of Object.entries(scheme.slots)) {
    map.set(hex.toUpperCase(), slot as Slot);
  }
  map.set('#FFFFFF', 'white');
  return map;
}

function resolveSlot(
  value: string | null,
  slotMap: ReadonlyMap<string, Slot>,
  context: string,
): Slot | undefined {
  if (!value || value === 'none') return undefined;
  const normalized = value.trim();
  if (normalized.toLowerCase() === 'white') return 'white';
  const slot = slotMap.get(normalized.toUpperCase());
  if (!slot) {
    throw new Error(`Unknown color "${normalized}" in ${context}`);
  }
  return slot;
}

function fragmentFromElement(
  element: Element,
  slotMap: ReadonlyMap<string, Slot>,
  context: string,
): FragmentPath {
  const d = element.getAttribute('d');
  if (!d) {
    throw new Error(`Path without d attribute in ${context}`);
  }
  const transform = element.getAttribute('transform');
  if (transform) {
    throw new Error(`Path transform is not allowed in ${context}: ${transform}`);
  }

  const fill = resolveSlot(element.getAttribute('fill'), slotMap, context);
  const stroke = resolveSlot(element.getAttribute('stroke'), slotMap, context);
  const attrs: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    if (!attr) continue;
    if (['id', 'd', 'fill', 'stroke', 'transform'].includes(attr.name)) continue;
    if (['clip-path', 'mask', 'filter'].includes(attr.name)) {
      throw new Error(`Unsupported attribute ${attr.name} in ${context}`);
    }
    attrs[attr.name] = attr.value;
  }

  const fragment: FragmentPath = { d };
  if (fill) fragment.fill = fill;
  if (stroke) fragment.stroke = stroke;
  if (Object.keys(attrs).length > 0) fragment.attrs = attrs;
  return fragment;
}

function unionBBox(paths: readonly string[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of paths) {
    const bbox = pathBBox(d);
    minX = Math.min(minX, bbox[0]);
    minY = Math.min(minY, bbox[1]);
    maxX = Math.max(maxX, bbox[2]);
    maxY = Math.max(maxY, bbox[3]);
  }
  if (!Number.isFinite(minX)) {
    throw new Error('Cannot compute bbox of an empty path list');
  }
  return [minX, minY, maxX, maxY];
}

function slotList(paths: readonly FragmentPath[]): (Slot | null)[] {
  return paths.map((fragment) => fragment.fill ?? fragment.stroke ?? null);
}

function isAlias(
  sourcePaths: readonly FragmentPath[],
  targetPaths: readonly FragmentPath[],
  sourceRaw: readonly string[],
  targetRaw: readonly string[],
): boolean {
  if (sourcePaths.length !== targetPaths.length) return false;

  const sourceSlots = slotList(sourcePaths).slice().sort();
  const targetSlots = slotList(targetPaths).slice().sort();
  if (sourceSlots.length !== targetSlots.length) return false;
  for (let i = 0; i < sourceSlots.length; i++) {
    if (sourceSlots[i] !== targetSlots[i]) return false;
  }

  const sourceSignatures = sourceRaw.map((d) => shapeSignature(d));
  const targetSignatures = targetRaw.map((d) => shapeSignature(d));
  const comparable = sourceSignatures.filter((signature) => signature !== null).length;
  if (comparable < 5) return false;

  const matches = matchShapes(sourceSignatures, targetSignatures);
  // Sub-3px paths are not comparable; every larger source path must have a match.
  return matches.length === comparable;
}

function validateBgSlots(paths: readonly FragmentPath[], context: string): void {
  for (const fragment of paths) {
    for (const slot of [fragment.fill, fragment.stroke]) {
      if (slot && !BG_SLOTS.includes(slot)) {
        throw new Error(`Background object uses non-bg slot "${slot}" in ${context}`);
      }
    }
  }
}

function matrixForNative(bbox: BBox): Matrix {
  return [1, 0, 0, 1, -bbox[0], -bbox[1]];
}

function matrixForFitted(fit: FitResult, targetBBox: BBox): Matrix {
  return [fit.scale, 0, 0, fit.scale, fit.tx - targetBBox[0], fit.ty - targetBBox[1]];
}

function geometryHashOf(paths: readonly FragmentPath[]): string {
  return sha1(
    JSON.stringify(
      paths.map((fragment) => [fragment.d, fragment.fill ?? null, fragment.stroke ?? null]),
    ),
  );
}

function extractVariant(
  entry: FigmaObjectEntry,
  size: DetailSize,
  state: ObjectState,
  root: Element,
  slotMap: ReadonlyMap<string, Slot>,
): { fragments: FragmentPath[]; raw: string[]; bbox: BBox } {
  const context = `${entry.id}.${state}.${size}`;
  const groupNames = entry.paths[size][state];
  const groupPath = groupNames.join(' > ');
  let group: Element;
  try {
    group = findGroup(root, groupNames);
  } catch {
    throw new Error(`Group not found for ${context}: ${groupPath}`);
  }

  const groupTransform = group.getAttribute('transform');
  if (groupTransform) {
    throw new Error(`Group transform is not allowed in ${context}: ${groupTransform}`);
  }

  const ignored = new Set((entry.ignoredPaths?.[size] ?? []).map((id) => id));
  const elements = collectPaths(group, ignored);
  const expected = entry.expectedPaths[size][state];
  if (elements.length !== expected) {
    const ids = elements.map((element) => elementId(element)).join(', ');
    throw new Error(
      `Path count mismatch in ${context}: expected ${expected}, got ${elements.length}. Paths: ${ids}`,
    );
  }

  const fragments = elements.map((element) =>
    fragmentFromElement(element, slotMap, `${context}#${elementId(element)}`),
  );
  const raw = fragments.map((fragment) => fragment.d);
  const bbox = unionBBox(raw);
  return { fragments, raw, bbox };
}

function findGroup(root: Element, names: readonly string[]): Element {
  let current = root;
  for (const name of names) {
    const children: Element[] = [];
    for (let i = 0; i < current.childNodes.length; i++) {
      const child = current.childNodes.item(i);
      if (child && child.nodeType === 1) children.push(child as Element);
    }
    const next = children.find((child) => child.tagName === 'g' && elementId(child) === name);
    if (!next) throw new Error(`Group not found: ${name}`);
    current = next;
  }
  return current;
}

export function buildLibrary(projectRoot: string, curated: CuratedData): BuiltLibrary {
  const scheme = getSourceScheme(curated.palettes);
  const slotMap = buildSlotMap(scheme);
  const roots: Record<DetailSize, Element> = {
    L: findSheetRoot(parseSvg(path.join(projectRoot, curated.figmaMap.sheets.L.file))),
    S: findSheetRoot(parseSvg(path.join(projectRoot, curated.figmaMap.sheets.S.file))),
  };

  const fragments = new Map<string, FragmentPath[]>();
  const diagnostics: FitDiagnostic[] = [];
  const objects: GeneratedObject[] = [];

  for (const entry of curated.figmaMap.objects) {
    const meta = getMeta(curated.meta, entry.id);
    const variants: GeneratedVariant[] = [];

    for (const state of STATES) {
      const target = extractVariant(entry, 'L', state, roots.L, slotMap);
      const source = extractVariant(entry, 'S', state, roots.S, slotMap);
      if (state === 'bg') {
        validateBgSlots(target.fragments, `${entry.id}.${state}.L`);
        validateBgSlots(source.fragments, `${entry.id}.${state}.S`);
      }

      const targetBBox = target.bbox;
      const targetMatrix = matrixForNative(targetBBox);
      const targetSize = bboxSize(targetBBox);
      let fit: FitResult;
      try {
        fit = fitSourceToTarget(source.raw, target.raw);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`S->L fit failed for ${entry.id}.${state}: ${message}`, { cause: error });
      }
      if (fit.rms >= 0.05) {
        throw new Error(
          `Bad S->L fit for ${entry.id}.${state}: rms=${fit.rms.toFixed(4)}, matches=${fit.matched}/${source.raw.length}`,
        );
      }

      const alias = isAlias(source.fragments, target.fragments, source.raw, target.raw);
      const targetKey = `${entry.id}.${state}.L`;
      fragments.set(targetKey, target.fragments);

      variants.push({
        key: targetKey,
        state,
        size: 'L',
        sizes: alias ? ['S', 'L'] : ['L'],
        file: `fragments/${targetKey}.json`,
        toNative: targetMatrix,
        bbox: targetSize,
        hull: hullTuples(buildHull(target.raw, targetMatrix)),
        geometryHash: geometryHashOf(target.fragments),
        pathCount: target.raw.length,
      });

      diagnostics.push({
        objectId: entry.id,
        state,
        kind: alias ? 'alias' : 'variant',
        matched: fit.matched,
        total: source.raw.length,
        scale: fit.scale,
        rms: fit.rms,
      });

      if (!alias) {
        const sourceMatrix = matrixForFitted(fit, targetBBox);
        const nativeBox = transformBBox(source.bbox, sourceMatrix);
        const nativeSize = bboxSize(nativeBox);
        if (
          Math.abs(nativeSize.w - targetSize.w) > 0.5 ||
          Math.abs(nativeSize.h - targetSize.h) > 0.5
        ) {
          throw new Error(
            `S bbox does not align with L for ${entry.id}.${state}: ` +
              `${nativeSize.w.toFixed(3)}x${nativeSize.h.toFixed(3)} vs ` +
              `${targetSize.w.toFixed(3)}x${targetSize.h.toFixed(3)}`,
          );
        }

        const sourceKey = `${entry.id}.${state}.S`;
        fragments.set(sourceKey, source.fragments);
        variants.push({
          key: sourceKey,
          state,
          size: 'S',
          sizes: ['S'],
          file: `fragments/${sourceKey}.json`,
          toNative: sourceMatrix,
          bbox: nativeSize,
          hull: hullTuples(buildHull(source.raw, sourceMatrix)),
          geometryHash: geometryHashOf(source.fragments),
          pathCount: source.raw.length,
          fit: {
            matched: fit.matched,
            total: source.raw.length,
            scale: fit.scale,
            rms: fit.rms,
          },
        });
      }
    }

    objects.push({
      id: entry.id,
      nameRu: meta.nameRu,
      nameEn: meta.nameEn,
      meta: {
        synonyms: meta.synonyms,
        tags: meta.tags,
        heroWeight: meta.heroWeight,
      },
      variants,
    });
  }

  const catalog: GeneratedCatalog = {
    version: 1,
    source: {
      library: {
        L: curated.figmaMap.sheets.L.file,
        S: curated.figmaMap.sheets.S.file,
      },
      palettes: 'data/curated/palettes.source.json',
    },
    objects,
    palettes: curated.palettes.schemes.map((item) => ({
      id: item.id,
      name: item.nameRu,
      builtin: true,
      slots: item.slots,
    })),
  };

  return { catalog, fragments, diagnostics };
}

export function writeLibrary(projectRoot: string, built: BuiltLibrary): void {
  const generatedDir = path.join(projectRoot, 'data', 'generated');
  const fragmentsDir = path.join(generatedDir, 'fragments');
  rmSync(fragmentsDir, { recursive: true, force: true });
  mkdirSync(fragmentsDir, { recursive: true });

  for (const [key, paths] of built.fragments) {
    writeFileSync(
      path.join(fragmentsDir, `${key}.json`),
      `${JSON.stringify(paths, null, 2)}\n`,
      'utf8',
    );
  }

  mkdirSync(generatedDir, { recursive: true });
  const catalogJson = `${JSON.stringify(built.catalog, null, 2)}\n`;
  writeFileSync(path.join(generatedDir, 'catalog.json'), catalogJson, 'utf8');
  // ESM-safe catalog for the Vercel function (no JSON import attributes needed).
  writeFileSync(
    path.join(generatedDir, 'catalog-data.ts'),
    `// AUTO-GENERATED by pnpm ingest. Do not edit.\nexport const catalogData: unknown = ${catalogJson.trimEnd()};\n`,
    'utf8',
  );
}
