import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Element } from '@xmldom/xmldom';
import { BG_SLOTS, OBJ_SLOTS } from '../../src/core/slots';
import type {
  DetailSize,
  FormatId,
  FragmentPath,
  ObjectId,
  ObjectState,
  Slot,
} from '../../src/core/types';
import type { CuratedData, PaletteScheme } from './curated';
import { getSourceScheme } from './curated';
import type { BuiltLibrary, GeneratedCatalog, GeneratedVariant } from './library';
import type {
  GeneratedSubstrate,
  SubstrateElementData,
  SubstrateFormatData,
  SubstrateId,
} from './substrates';
import {
  childElements,
  elementId,
  findSheetRoot,
  parseSvg,
  pathBBox,
  shapeDistance,
  shapeSignature,
  transformBBox,
  type ShapeSignature,
} from './svg';

type BBox = [number, number, number, number];

export interface TemplateItem {
  objectId: ObjectId;
  state: ObjectState;
  size: DetailSize;
  x: number;
  y: number;
  z: number;
}

export interface Template {
  id: string;
  sceneId: string;
  format: FormatId;
  scheme: string;
  substrate: SubstrateId;
  /** Source frame group id, kept for golden rendering. */
  frameId: string;
  items: TemplateItem[];
}

export interface TemplatesFile {
  version: 1;
  templates: Template[];
}

export interface Relation {
  from: ObjectId;
  fromState: ObjectState;
  to: ObjectId;
  toState: ObjectState;
  offsets: [number, number][];
  count: number;
}

export interface RelationsFile {
  version: 1;
  relations: Relation[];
}

export interface FormatStats {
  templates: number;
  itemsPerScene: { mean: number; median: number };
  cropShare: { mean: number; median: number; p90: number };
  density: { mean: number; median: number };
  emptyLeft: { mean: number; median: number };
  minDistance: { mean: number; median: number };
}

export interface ColorPermutation {
  objectId: ObjectId;
  sceneId: string;
  format: FormatId;
  differences: number;
  /** True only when every difference is a swap among obj-1..obj-3. */
  pureObjPermutation: boolean;
  pairs: [Slot, Slot][];
}

export interface StatsFile {
  version: 1;
  byFormat: Record<FormatId, FormatStats>;
  colorPermutations: ColorPermutation[];
}

export interface ExampleBuild {
  templates: Template[];
  relations: RelationsFile;
  stats: StatsFile;
  substrates: GeneratedSubstrate[];
  warnings: string[];
}

interface GroupPath {
  d: string;
  slot?: Slot;
  hex: string;
}

interface VariantShapeEntry {
  index: number;
  sig: ShapeSignature;
  nativeBox: BBox;
  slot: Slot | null;
  key: string;
}

interface VariantIndex {
  variant: GeneratedVariant;
  objectId: ObjectId;
  state: ObjectState;
  size: DetailSize;
  fragments: FragmentPath[];
  entries: VariantShapeEntry[];
  byKey: Map<string, number[]>;
}

interface Match {
  source: number;
  target: number;
  distance: number;
}

interface InternalItem extends TemplateItem {
  hull: [number, number][];
  matched: number;
  totalPaths: number;
  scale: number;
  colorDifferences: [Slot, Slot][];
}

interface FrameInfo {
  index: number;
  id: string;
  width: number;
  height: number;
  origin: [number, number];
  fill: string;
  element: Element;
}

const FORMATS: { width: number; height: number; format: FormatId }[] = [
  { width: 1000, height: 1000, format: 'square' },
  { width: 1200, height: 630, format: 'wide' },
  { width: 800, height: 1200, format: 'tall' },
];

const SUBSTRATE_GROUP_RE = /^(конфетти|Group_\d+)$/;

export function buildExamples(
  projectRoot: string,
  curated: CuratedData,
  library: BuiltLibrary,
  baseSubstrates: readonly GeneratedSubstrate[],
): ExampleBuild {
  const warnings: string[] = [];
  const purple = getSourceScheme(curated.palettes);
  const colorMap = buildColorMap(purple);
  const variants = buildVariantIndexes(library.catalog, library.fragments, warnings);
  const frames = readFrames(projectRoot);

  const templates: InternalItem[][] = [];
  const templateMeta: {
    id: string;
    sceneId: string;
    format: FormatId;
    scheme: string;
    substrate: SubstrateId;
    frameId: string;
  }[] = [];
  const sceneIds = new Map<string, string>();
  const substrateData = new Map<string, { data: SubstrateFormatData; signature: string }>();
  const colorPermutations: ColorPermutation[] = [];

  frames.forEach((frame) => {
    const format = formatOf(frame.width, frame.height);
    if (!format) {
      warnings.push(`Unknown frame size ${frame.width}x${frame.height} in ${frame.id}`);
      return;
    }

    const objectGroups: Element[] = [];
    const substrateGroups: Element[] = [];
    for (const child of childElements(frame.element)) {
      if (child.tagName !== 'g') continue;
      const name = elementId(child);
      if (SUBSTRATE_GROUP_RE.test(name) || name.startsWith('конфетти')) {
        substrateGroups.push(child);
      } else {
        objectGroups.push(child);
      }
    }

    const items: InternalItem[] = [];
    objectGroups.forEach((group, z) => {
      const paths = collectGroupPaths(group, colorMap, `${frame.id}/${elementId(group)}`);
      if (paths.length === 0) return;
      const match = matchGroup(paths, variants);
      if (!match) {
        warnings.push(
          `No object match for ${frame.id}/${elementId(group)} (${paths.length} paths)`,
        );
        return;
      }
      const item = buildItem(paths, match, group, z, frame.origin, colorMap);
      if (!item) {
        warnings.push(`Could not place ${frame.id}/${elementId(group)}`);
        return;
      }
      items.push(item);
      if (Math.abs(item.scale - 1) > 0.002) {
        warnings.push(
          `Scale ${item.scale.toFixed(4)} for ${frame.id}/${elementId(group)} (${item.objectId})`,
        );
      }
      if (item.colorDifferences.length > 0) {
        const pairs = uniquePairs(item.colorDifferences);
        colorPermutations.push({
          objectId: item.objectId,
          sceneId: 'pending',
          format,
          differences: item.colorDifferences.length,
          pureObjPermutation: pairs.every(
            ([from, to]) => OBJ_SLOTS.includes(from) && OBJ_SLOTS.includes(to),
          ),
          pairs,
        });
      }
    });

    const sceneKey = [...new Set(items.map((item) => item.objectId))].sort().join(',');
    let sceneId = sceneIds.get(sceneKey);
    if (!sceneId) {
      sceneId = `scene-${sceneIds.size + 1}`;
      sceneIds.set(sceneKey, sceneId);
    }
    const substrate = detectSubstrate(frame.element, substrateGroups);
    const substrateElements = collectSubstrateElements(frame, substrateGroups, colorMap);
    const substrateFormat: SubstrateFormatData = {
      width: frame.width,
      height: frame.height,
      origin: frame.origin,
      elements: substrateElements,
    };
    const signature = substrateSignature(substrateFormat);
    const key = `${substrate}.${format}`;
    const existing = substrateData.get(key);
    if (!existing) {
      substrateData.set(key, { data: substrateFormat, signature });
    } else if (existing.signature !== signature) {
      warnings.push(`Substrate ${key} differs between frames (${frame.id}); keeping first`);
    }

    templates.push(items);
    templateMeta.push({
      id: `${sceneId}-${format}`,
      sceneId,
      format,
      scheme: schemeForFill(frame.fill, curated, warnings),
      substrate,
      frameId: frame.id,
    });

    for (const permutation of colorPermutations) {
      if (permutation.sceneId === 'pending') permutation.sceneId = sceneId;
    }
  });

  if (sceneIds.size !== 6) {
    warnings.push(`Expected 6 scenes, found ${sceneIds.size}`);
  }

  const outputTemplates: Template[] = templates.map((items, index) => {
    const meta = templateMeta[index]!;
    return {
      id: meta.id,
      sceneId: meta.sceneId,
      format: meta.format,
      scheme: meta.scheme,
      substrate: meta.substrate,
      frameId: meta.frameId,
      items: items.map((item) => ({
        objectId: item.objectId,
        state: item.state,
        size: item.size,
        x: round(item.x, 3),
        y: round(item.y, 3),
        z: item.z,
      })),
    };
  });

  const formatOrder: Record<FormatId, number> = { square: 0, wide: 1, tall: 2 };
  outputTemplates.sort(
    (a, b) =>
      Number(a.sceneId.split('-')[1]) - Number(b.sceneId.split('-')[1]) ||
      formatOrder[a.format] - formatOrder[b.format],
  );

  const relations = buildRelations(templates);
  const stats = buildStats(templates, templateMeta, colorPermutations);
  const substrates = mergeSubstrates(baseSubstrates, substrateData);

  return {
    templates: outputTemplates,
    relations,
    stats,
    substrates,
    warnings,
  };
}

function buildColorMap(scheme: PaletteScheme): {
  slotByHex: Map<string, Slot>;
  slots: { slot: Slot; rgb: [number, number, number] }[];
} {
  const slotByHex = new Map<string, Slot>();
  const slots: { slot: Slot; rgb: [number, number, number] }[] = [];
  for (const [slot, hex] of Object.entries(scheme.slots)) {
    const normalized = hex.toUpperCase();
    slotByHex.set(normalized, slot as Slot);
    slots.push({ slot: slot as Slot, rgb: hexToRgb(normalized) });
  }
  slotByHex.set('#FFFFFF', 'white');
  return { slotByHex, slots };
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function colorToSlot(
  hex: string | null,
  colorMap: ReturnType<typeof buildColorMap>,
  context: string,
): Slot | undefined {
  if (!hex || hex === 'none') return undefined;
  if (hex.toLowerCase() === 'white') return 'white';
  if (!hex.startsWith('#')) return undefined;
  const normalized = hex.toUpperCase();
  const exact = colorMap.slotByHex.get(normalized);
  if (exact) return exact;

  const rgb = hexToRgb(normalized);
  let best: { slot: Slot; distance: number } | null = null;
  for (const candidate of colorMap.slots) {
    const distance =
      (candidate.rgb[0] - rgb[0]) ** 2 +
      (candidate.rgb[1] - rgb[1]) ** 2 +
      (candidate.rgb[2] - rgb[2]) ** 2;
    if (!best || distance < best.distance) best = { slot: candidate.slot, distance };
  }
  if (!best) {
    throw new Error(`Cannot map color ${hex} in ${context}`);
  }
  return best.slot;
}

function collectGroupPaths(
  group: Element,
  colorMap: ReturnType<typeof buildColorMap>,
  context: string,
): GroupPath[] {
  const result: GroupPath[] = [];
  const walk = (node: Element): void => {
    if (node.tagName === 'path') {
      const d = node.getAttribute('d');
      if (!d) return;
      const hex = node.getAttribute('fill') ?? '';
      const slot = colorToSlot(hex, colorMap, context);
      result.push({ d, hex, ...(slot ? { slot } : {}) });
      return;
    }
    const transform = node.getAttribute('transform');
    if (transform) {
      throw new Error(`Transform in example group ${context}: ${transform}`);
    }
    for (const child of childElements(node)) walk(child);
  };
  for (const child of childElements(group)) walk(child);
  return result;
}

function buildVariantIndexes(
  catalog: GeneratedCatalog,
  fragments: Map<string, FragmentPath[]>,
  warnings: string[],
): VariantIndex[] {
  const result: VariantIndex[] = [];
  for (const object of catalog.objects) {
    for (const variant of object.variants) {
      const paths = fragments.get(variant.key);
      if (!paths) {
        warnings.push(`Missing fragment ${variant.key}`);
        continue;
      }
      const entries: VariantShapeEntry[] = [];
      const byKey = new Map<string, number[]>();
      paths.forEach((fragment, index) => {
        const sig = shapeSignature(fragment.d, 32, 3);
        if (!sig) return;
        const nativeBox = transformBBox(pathBBox(fragment.d), variant.toNative);
        const key = shapeKey(sig);
        entries.push({
          index,
          sig,
          nativeBox,
          slot: fragment.fill ?? fragment.stroke ?? null,
          key,
        });
        const list = byKey.get(key);
        if (list) list.push(entries.length - 1);
        else byKey.set(key, [entries.length - 1]);
      });
      result.push({
        variant,
        objectId: object.id,
        state: variant.state,
        size: variant.size,
        fragments: paths,
        entries,
        byKey,
      });
    }
  }
  return result;
}

function shapeKey(sig: ShapeSignature): string {
  return sig.samples.map((value) => Math.round(value * 10)).join(',');
}

function matchVariant(groupShapes: (ShapeSignature | null)[], variant: VariantIndex): Match[] {
  const used = new Set<number>();
  const matches: Match[] = [];
  groupShapes.forEach((source, sourceIndex) => {
    if (!source) return;
    const candidates = variant.byKey.get(shapeKey(source));
    if (!candidates) return;
    let best: Match | null = null;
    for (const entryIndex of candidates) {
      if (used.has(entryIndex)) continue;
      const entry = variant.entries[entryIndex]!;
      const distance = shapeDistance(source, entry.sig);
      if (distance > 0.02) continue;
      if (!best || distance < best.distance) {
        best = { source: sourceIndex, target: entry.index, distance };
      }
    }
    if (best) {
      used.add(best.target);
      matches.push(best);
    }
  });
  return matches;
}

interface GroupMatch {
  variant: VariantIndex;
  matches: Match[];
}

function matchGroup(
  paths: readonly GroupPath[],
  variants: readonly VariantIndex[],
): GroupMatch | null {
  const shapes = paths.map((path) => shapeSignature(path.d, 32, 3));
  const state = inferState(paths);
  let candidates = variants;
  if (state) {
    const filtered = variants.filter((variant) => variant.state === state);
    if (filtered.length > 0) candidates = filtered;
  }

  let best: { variant: VariantIndex; matches: Match[]; score: number } | null = null;
  for (const variant of candidates) {
    const matches = matchVariant(shapes, variant);
    if (matches.length < 5) continue;
    const score = matches.length;
    if (
      !best ||
      score > best.score ||
      (score === best.score && variant.size === 'L' && best.variant.size !== 'L')
    ) {
      best = { variant, matches, score };
    }
  }
  if (!best) return null;
  return { variant: best.variant, matches: best.matches };
}

function inferState(paths: readonly GroupPath[]): ObjectState | undefined {
  const slots = paths.map((path) => path.slot).filter((slot): slot is Slot => slot !== undefined);
  if (slots.length === 0) return undefined;
  return slots.every((slot) => BG_SLOTS.includes(slot)) ? 'bg' : 'main';
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function buildItem(
  paths: readonly GroupPath[],
  match: GroupMatch,
  group: Element,
  z: number,
  frameOrigin: [number, number],
  colorMap: ReturnType<typeof buildColorMap>,
): InternalItem | null {
  const scales: number[] = [];
  const dxs: number[] = [];
  const dys: number[] = [];
  const colorDifferences: [Slot, Slot][] = [];

  for (const pair of match.matches) {
    const sourcePath = paths[pair.source];
    const fragment = match.variant.fragments[pair.target];
    if (!sourcePath || !fragment) continue;
    const sourceBox = pathBBox(sourcePath.d);
    const nativeBox = transformBBox(pathBBox(fragment.d), match.variant.variant.toNative);
    const sourceSize = Math.max(sourceBox[2] - sourceBox[0], sourceBox[3] - sourceBox[1]);
    const nativeSize = Math.max(nativeBox[2] - nativeBox[0], nativeBox[3] - nativeBox[1]);
    if (nativeSize > 0) scales.push(sourceSize / nativeSize);
    dxs.push(sourceBox[0] - nativeBox[0]);
    dys.push(sourceBox[1] - nativeBox[1]);

    const fragmentSlot = fragment.fill ?? fragment.stroke ?? null;
    const exampleSlot = colorToSlot(sourcePath.hex, colorMap, elementId(group));
    if (
      fragmentSlot &&
      exampleSlot &&
      fragmentSlot !== exampleSlot &&
      (OBJ_SLOTS.includes(fragmentSlot) || OBJ_SLOTS.includes(exampleSlot))
    ) {
      colorDifferences.push([fragmentSlot, exampleSlot]);
    }
  }

  if (match.matches.length === 0 || scales.length === 0) return null;
  const scale = median(scales);
  const x = median(dxs) - frameOrigin[0];
  const y = median(dys) - frameOrigin[1];

  return {
    objectId: match.variant.objectId,
    state: match.variant.state,
    size: match.variant.size,
    x: round(x, 3),
    y: round(y, 3),
    z,
    hull: match.variant.variant.hull,
    matched: match.matches.length,
    totalPaths: match.variant.variant.pathCount,
    scale,
    colorDifferences,
  };
}

function uniquePairs(pairs: readonly [Slot, Slot][]): [Slot, Slot][] {
  const seen = new Set<string>();
  const result: [Slot, Slot][] = [];
  for (const pair of pairs) {
    const key = `${pair[0]}>${pair[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(pair);
  }
  return result;
}

function formatOf(width: number, height: number): FormatId | null {
  const found = FORMATS.find((item) => item.width === width && item.height === height);
  return found?.format ?? null;
}

function readFrames(projectRoot: string): FrameInfo[] {
  const file = path.join(projectRoot, 'data', 'source', 'examples', 'composition-examples.svg');
  const root = findSheetRoot(parseSvg(file));
  const frames: FrameInfo[] = [];
  for (const child of childElements(root)) {
    if (child.tagName !== 'g' || !/^Фон(_\d+)?$/.test(elementId(child))) continue;
    const rect = childElements(child).find((element) => element.tagName === 'rect');
    if (!rect) continue;
    const width = Number(rect.getAttribute('width'));
    const height = Number(rect.getAttribute('height'));
    const transform = rect.getAttribute('transform') ?? '';
    const match = /translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/.exec(transform);
    frames.push({
      index: frames.length,
      id: elementId(child),
      width,
      height,
      origin: [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0)],
      fill: rect.getAttribute('fill') ?? '',
      element: child,
    });
  }
  return frames;
}

function schemeForFill(fill: string, curated: CuratedData, warnings: string[]): string {
  const normalized = fill.toUpperCase();
  for (const scheme of curated.palettes.schemes) {
    if (scheme.slots['bg-light'].toUpperCase() === normalized) return scheme.id;
  }
  warnings.push(`Unknown frame background ${fill}`);
  return 'purple';
}

function detectSubstrate(frame: Element, substrateGroups: readonly Element[]): SubstrateId {
  const lines = childElements(frame).filter((child) => child.tagName === 'line');
  if (substrateGroups.length > 0 || lines.length >= 3) return 'confetti';
  return 'diagonal';
}

function collectSubstrateElements(
  frame: FrameInfo,
  substrateGroups: readonly Element[],
  colorMap: ReturnType<typeof buildColorMap>,
): SubstrateElementData[] {
  const elements: SubstrateElementData[] = [];
  const frameRect = childElements(frame.element).find((child) => child.tagName === 'rect');
  if (frameRect) {
    const fill = colorToSlot(frameRect.getAttribute('fill'), colorMap, frame.id);
    if (fill) {
      elements.push({
        tag: 'rect',
        x: frame.origin[0],
        y: frame.origin[1],
        width: Number(frameRect.getAttribute('width')),
        height: Number(frameRect.getAttribute('height')),
        fill,
      });
    }
  }

  for (const child of childElements(frame.element)) {
    if (child.tagName === 'g') continue;
    if (child.tagName === 'line') {
      const stroke = colorToSlot(child.getAttribute('stroke'), colorMap, frame.id);
      if (!stroke) continue;
      elements.push({
        tag: 'line',
        x1: Number(child.getAttribute('x1')),
        y1: Number(child.getAttribute('y1')),
        x2: Number(child.getAttribute('x2')),
        y2: Number(child.getAttribute('y2')),
        stroke,
        ...lineAttrs(child),
      });
      continue;
    }
    if (child.tagName === 'path') {
      const fill = colorToSlot(child.getAttribute('fill'), colorMap, frame.id);
      const stroke = colorToSlot(child.getAttribute('stroke'), colorMap, frame.id);
      if (fill === 'white' || fill === 'bg-light') continue;
      if (fill !== 'bg-mid' && fill !== 'bg-dark' && stroke !== 'bg-dark') continue;
      const d = child.getAttribute('d');
      if (!d) continue;
      elements.push({
        tag: 'path',
        d,
        ...(fill ? { fill } : {}),
        ...(stroke ? { stroke } : {}),
        ...pathAttrs(child),
      });
    }
  }

  for (const group of substrateGroups) {
    for (const child of collectDescendants(group, 'path')) {
      const d = child.getAttribute('d');
      if (!d) continue;
      const fill = colorToSlot(child.getAttribute('fill'), colorMap, frame.id);
      const stroke = colorToSlot(child.getAttribute('stroke'), colorMap, frame.id);
      if (!fill && !stroke) continue;
      elements.push({
        tag: 'path',
        d,
        ...(fill ? { fill } : {}),
        ...(stroke ? { stroke } : {}),
        ...pathAttrs(child),
      });
    }
  }

  return elements;
}

function collectDescendants(node: Element, tag: string, out: Element[] = []): Element[] {
  if (node.tagName === tag) out.push(node);
  for (const child of childElements(node)) collectDescendants(child, tag, out);
  return out;
}

function pathAttrs(element: Element): { attrs?: Record<string, string> } {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    if (!attr) continue;
    if (['id', 'd', 'fill', 'stroke', 'transform'].includes(attr.name)) continue;
    attrs[attr.name] = attr.value;
  }
  return Object.keys(attrs).length > 0 ? { attrs } : {};
}

function lineAttrs(element: Element): { attrs?: Record<string, string> } {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    if (!attr) continue;
    if (['id', 'x1', 'y1', 'x2', 'y2', 'stroke', 'transform'].includes(attr.name)) continue;
    attrs[attr.name] = attr.value;
  }
  return Object.keys(attrs).length > 0 ? { attrs } : {};
}

function substrateSignature(format: SubstrateFormatData): string {
  return JSON.stringify(
    format.elements.map((element) => {
      if (element.tag === 'path') {
        const sig = shapeSignature(element.d ?? '', 16, 0.5);
        const bbox = pathBBox(element.d ?? '');
        return [
          'path',
          sig?.samples.map((value) => Math.round(value * 10)),
          Math.round(bbox[0] - format.origin[0]),
          Math.round(bbox[1] - format.origin[1]),
          element.fill ?? '',
          element.stroke ?? '',
        ];
      }
      if (element.tag === 'line') {
        return [
          'line',
          Math.round((element.x1 ?? 0) - format.origin[0]),
          Math.round((element.y1 ?? 0) - format.origin[1]),
          Math.round((element.x2 ?? 0) - format.origin[0]),
          Math.round((element.y2 ?? 0) - format.origin[1]),
          element.stroke ?? '',
        ];
      }
      return ['rect', element.width, element.height, element.fill ?? ''];
    }),
  );
}

function mergeSubstrates(
  base: readonly GeneratedSubstrate[],
  overrides: Map<string, { data: SubstrateFormatData; signature: string }>,
): GeneratedSubstrate[] {
  return base.map((substrate) => {
    const byFormat = { ...substrate.byFormat };
    for (const format of Object.keys(byFormat) as FormatId[]) {
      const override = overrides.get(`${substrate.id}.${format}`);
      if (override) byFormat[format] = override.data;
    }
    return { ...substrate, byFormat };
  });
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildRelations(templates: readonly InternalItem[][]): RelationsFile {
  const aggregated = new Map<string, { offsets: Map<string, [number, number]>; count: number }>();

  for (const items of templates) {
    for (let i = 0; i < items.length; i++) {
      const upper = items[i]!;
      for (let j = 0; j < items.length; j++) {
        const lower = items[j]!;
        if (upper === lower || upper.z <= lower.z) continue;
        if (!hullsOverlap(upper, lower)) continue;
        const key = `${upper.objectId}:${upper.state}->${lower.objectId}:${lower.state}`;
        const offset: [number, number] = [round(upper.x - lower.x, 1), round(upper.y - lower.y, 1)];
        const bucket = aggregated.get(key) ?? { offsets: new Map(), count: 0 };
        bucket.offsets.set(`${offset[0]},${offset[1]}`, offset);
        bucket.count++;
        aggregated.set(key, bucket);
      }
    }
  }

  const relations: Relation[] = [];
  for (const [key, bucket] of aggregated) {
    const [fromPart, toPart] = key.split('->');
    if (!fromPart || !toPart) continue;
    const [from, fromState] = fromPart.split(':');
    const [to, toState] = toPart.split(':');
    relations.push({
      from: from as ObjectId,
      fromState: fromState as ObjectState,
      to: to as ObjectId,
      toState: toState as ObjectState,
      offsets: [...bucket.offsets.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      count: bucket.count,
    });
  }

  relations.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.fromState.localeCompare(b.fromState) ||
      a.toState.localeCompare(b.toState),
  );
  return { version: 1, relations };
}

function hullsOverlap(a: InternalItem, b: InternalItem): boolean {
  const aBox: BBox = [
    Math.min(...a.hull.map((point) => point[0])) + a.x,
    Math.min(...a.hull.map((point) => point[1])) + a.y,
    Math.max(...a.hull.map((point) => point[0])) + a.x,
    Math.max(...a.hull.map((point) => point[1])) + a.y,
  ];
  const bBox: BBox = [
    Math.min(...b.hull.map((point) => point[0])) + b.x,
    Math.min(...b.hull.map((point) => point[1])) + b.y,
    Math.max(...b.hull.map((point) => point[0])) + b.x,
    Math.max(...b.hull.map((point) => point[1])) + b.y,
  ];
  if (aBox[2] <= bBox[0] || bBox[2] <= aBox[0] || aBox[3] <= bBox[1] || bBox[3] <= aBox[1]) {
    return false;
  }
  return satOverlap(
    a.hull.map(([x, y]) => [x + a.x, y + a.y] as [number, number]),
    b.hull.map(([x, y]) => [x + b.x, y + b.y] as [number, number]),
  );
}

function satOverlap(a: readonly [number, number][], b: readonly [number, number][]): boolean {
  const polygons = [a, b];
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i]!;
      const p2 = polygon[(i + 1) % polygon.length]!;
      const axis: [number, number] = [-(p2[1] - p1[1]), p2[0] - p1[0]];
      const [minA, maxA] = project(a, axis);
      const [minB, maxB] = project(b, axis);
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

function project(polygon: readonly [number, number][], axis: [number, number]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of polygon) {
    const value = x * axis[0] + y * axis[1];
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
}

function buildStats(
  templates: readonly InternalItem[][],
  meta: readonly { format: FormatId; sceneId: string }[],
  colorPermutations: readonly ColorPermutation[],
): StatsFile {
  const byFormat = {} as Record<FormatId, FormatStats>;
  for (const { format } of FORMATS) {
    const indexes = meta
      .map((item, index) => (item.format === format ? index : -1))
      .filter((index) => index >= 0);
    const cropShares: number[] = [];
    const densities: number[] = [];
    const emptyLeft: number[] = [];
    const minDistances: number[] = [];
    const itemCounts: number[] = [];

    for (const index of indexes) {
      const items = templates[index]!;
      itemCounts.push(items.length);
      for (const item of items) {
        cropShares.push(1 - item.matched / item.totalPaths);
      }
      densities.push(densityOf(items, frameSize(format)));
      emptyLeft.push(emptyLeftOf(items, frameSize(format).width));
      minDistances.push(minDistanceOf(items));
    }

    byFormat[format] = {
      templates: indexes.length,
      itemsPerScene: { mean: mean(itemCounts), median: median(itemCounts) },
      cropShare: {
        mean: mean(cropShares),
        median: median(cropShares),
        p90: percentile(cropShares, 0.9),
      },
      density: { mean: mean(densities), median: median(densities) },
      emptyLeft: { mean: mean(emptyLeft), median: median(emptyLeft) },
      minDistance: { mean: mean(minDistances), median: median(minDistances) },
    };
  }

  return {
    version: 1,
    byFormat,
    colorPermutations: mergePermutations(colorPermutations),
  };
}

function mergePermutations(permutations: readonly ColorPermutation[]): ColorPermutation[] {
  return permutations
    .map((item) => ({ ...item }))
    .sort(
      (a, b) =>
        a.objectId.localeCompare(b.objectId) ||
        a.sceneId.localeCompare(b.sceneId) ||
        a.format.localeCompare(b.format),
    );
}

function frameSize(format: FormatId): { width: number; height: number } {
  const found = FORMATS.find((item) => item.format === format);
  return { width: found?.width ?? 1000, height: found?.height ?? 1000 };
}

function densityOf(
  items: readonly InternalItem[],
  size: { width: number; height: number },
): number {
  const step = 25;
  let covered = 0;
  let total = 0;
  for (let x = step / 2; x < size.width; x += step) {
    for (let y = step / 2; y < size.height; y += step) {
      total++;
      if (items.some((item) => pointInHull(x, y, item))) covered++;
    }
  }
  return total > 0 ? covered / total : 0;
}

function pointInHull(x: number, y: number, item: InternalItem): boolean {
  const hull = item.hull;
  let inside = false;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const xi = hull[i]![0] + item.x;
    const yi = hull[i]![1] + item.y;
    const xj = hull[j]![0] + item.x;
    const yj = hull[j]![1] + item.y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function emptyLeftOf(items: readonly InternalItem[], width: number): number {
  if (items.length === 0) return 1;
  const minX = Math.min(
    ...items.map((item) => Math.min(...item.hull.map((point) => point[0])) + item.x),
  );
  return Math.min(1, Math.max(0, minX / width));
}

function minDistanceOf(items: readonly InternalItem[]): number {
  if (items.length < 2) return 0;
  let best = Infinity;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      for (const pa of a.hull) {
        for (const pb of b.hull) {
          const distance = Math.hypot(pa[0] + a.x - (pb[0] + b.x), pa[1] + a.y - (pb[1] + b.y));
          best = Math.min(best, distance);
        }
      }
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index]!;
}

export function writeExamples(projectRoot: string, build: ExampleBuild): void {
  const generatedDir = path.join(projectRoot, 'data', 'generated');
  writeFileSync(
    path.join(generatedDir, 'templates.json'),
    `${JSON.stringify({ version: 1, templates: build.templates }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(generatedDir, 'relations.json'),
    `${JSON.stringify(build.relations, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(generatedDir, 'stats.json'),
    `${JSON.stringify(build.stats, null, 2)}\n`,
    'utf8',
  );
}
