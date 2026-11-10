import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Element } from '@xmldom/xmldom';
import { BG_SLOTS } from '../../src/core/slots';
import type { FormatId, Slot } from '../../src/core/types';
import { getSourceScheme, type CuratedData, type PaletteScheme } from './curated';
import {
  childElements,
  elementId,
  findSheetRoot,
  parseSvg,
  pathBBox,
  pathSignature,
  resolveGroup,
} from './svg';

export type SubstrateId = 'confetti' | 'diagonal';

export interface SubstrateElementData {
  tag: 'path' | 'rect' | 'line';
  fill?: Slot;
  stroke?: Slot;
  d?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  attrs?: Record<string, string>;
}

export interface SubstrateFormatData {
  width: number;
  height: number;
  origin: [number, number];
  elements: SubstrateElementData[];
  fallback?: boolean;
}

export interface GeneratedSubstrate {
  id: SubstrateId;
  formats: Record<FormatId, SubstrateFormatData>;
}

const FORMAT_IDS: readonly FormatId[] = ['square', 'wide', 'tall'];
const FRAME_SIZE = { width: 1000, height: 1000 };

function buildSlotMap(scheme: PaletteScheme): Map<string, Slot> {
  const map = new Map<string, Slot>();
  for (const [slot, hex] of Object.entries(scheme.slots)) {
    map.set(hex.toUpperCase(), slot as Slot);
  }
  map.set('#FFFFFF', 'white');
  return map;
}

function slotFor(
  value: string | null,
  slotMap: ReadonlyMap<string, Slot>,
  context: string,
): Slot | undefined {
  if (!value || value === 'none') return undefined;
  const normalized = value.trim();
  if (normalized.toLowerCase() === 'white') return 'white';
  const slot = slotMap.get(normalized.toUpperCase());
  if (!slot) {
    throw new Error(`Unknown substrate color "${normalized}" in ${context}`);
  }
  return slot;
}

function numberAttr(element: Element, name: string, context: string): number {
  const value = Number(element.getAttribute(name));
  if (!Number.isFinite(value)) {
    throw new Error(`Missing or invalid ${name} in ${context}`);
  }
  return value;
}

function parseTranslate(transform: string | null, context: string): [number, number] {
  if (!transform) return [0, 0];
  const match = /^translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)$/.exec(transform.trim());
  if (!match) {
    throw new Error(`Unsupported substrate transform in ${context}: ${transform}`);
  }
  return [Number(match[1]), Number(match[2] ?? 0)];
}

function collectSubstrateElements(
  container: Element,
  slotMap: ReadonlyMap<string, Slot>,
  origin: [number, number],
  context: string,
): SubstrateElementData[] {
  const result: SubstrateElementData[] = [];

  const walk = (element: Element): void => {
    const transform = element.getAttribute('transform');
    if (transform && element.tagName !== 'rect') {
      throw new Error(`Unsupported transform on substrate element in ${context}: ${transform}`);
    }
    if (element.tagName === 'rect') {
      const fill = slotFor(element.getAttribute('fill'), slotMap, context);
      if (!fill) {
        throw new Error(`Substrate rect without fill in ${context}`);
      }
      result.push({
        tag: 'rect',
        x: origin[0] + Number(element.getAttribute('x') ?? 0),
        y: origin[1] + Number(element.getAttribute('y') ?? 0),
        width: numberAttr(element, 'width', context),
        height: numberAttr(element, 'height', context),
        fill,
      });
      return;
    }
    if (element.tagName === 'path') {
      const d = element.getAttribute('d');
      if (!d) throw new Error(`Substrate path without d in ${context}`);
      const fill = slotFor(element.getAttribute('fill'), slotMap, context);
      const stroke = slotFor(element.getAttribute('stroke'), slotMap, context);
      const attrs: Record<string, string> = {};
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        if (!attr) continue;
        if (['id', 'd', 'fill', 'stroke', 'transform'].includes(attr.name)) continue;
        attrs[attr.name] = attr.value;
      }
      const item: SubstrateElementData = { tag: 'path', d };
      if (fill) item.fill = fill;
      if (stroke) item.stroke = stroke;
      if (Object.keys(attrs).length > 0) item.attrs = attrs;
      result.push(item);
      return;
    }
    if (element.tagName === 'line') {
      const stroke = slotFor(element.getAttribute('stroke'), slotMap, context);
      if (!stroke) throw new Error(`Substrate line without stroke in ${context}`);
      const attrs: Record<string, string> = {};
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        if (!attr) continue;
        if (['id', 'x1', 'y1', 'x2', 'y2', 'stroke', 'transform'].includes(attr.name)) continue;
        attrs[attr.name] = attr.value;
      }
      const item: SubstrateElementData = {
        tag: 'line',
        x1: numberAttr(element, 'x1', context),
        y1: numberAttr(element, 'y1', context),
        x2: numberAttr(element, 'x2', context),
        y2: numberAttr(element, 'y2', context),
        stroke,
      };
      if (Object.keys(attrs).length > 0) item.attrs = attrs;
      result.push(item);
      return;
    }

    for (const child of childElements(element)) {
      walk(child);
    }
  };

  for (const child of childElements(container)) {
    walk(child);
  }
  return result;
}

function validateSubstrateSlots(
  elements: readonly SubstrateElementData[],
  allowWhite: boolean,
  context: string,
): void {
  for (const element of elements) {
    for (const slot of [element.fill, element.stroke]) {
      if (!slot) continue;
      if (slot === 'white' && allowWhite) continue;
      if (!BG_SLOTS.includes(slot)) {
        throw new Error(`Substrate uses non-bg slot "${slot}" in ${context}`);
      }
    }
  }
}

function extractSubstrate(
  root: Element,
  groupNames: readonly string[],
  scheme: PaletteScheme,
  allowWhite: boolean,
  id: SubstrateId,
): { origin: [number, number]; elements: SubstrateElementData[] } {
  const group = resolveGroup(root, groupNames);
  const context = `substrate ${id} (${groupNames.join(' > ')})`;
  const firstRect = childElements(group).find((child) => child.tagName === 'rect');
  if (!firstRect) {
    throw new Error(`Substrate rect not found in ${context}`);
  }
  const origin = parseTranslate(firstRect.getAttribute('transform'), context);
  const elements = collectSubstrateElements(group, buildSlotMap(scheme), origin, context);
  validateSubstrateSlots(elements, allowWhite, context);

  if (elements.length === 0) {
    throw new Error(`Substrate has no elements: ${context}`);
  }
  if (elementId(group) === '') {
    throw new Error(`Substrate group has no id: ${context}`);
  }
  return { origin, elements };
}

function cloneFormat(source: SubstrateFormatData, fallback: boolean): SubstrateFormatData {
  return {
    width: source.width,
    height: source.height,
    origin: [...source.origin],
    elements: source.elements.map((element) => ({ ...element })),
    ...(fallback ? { fallback: true } : {}),
  };
}

export function buildSubstrates(projectRoot: string, curated: CuratedData): GeneratedSubstrate[] {
  const libraryRoot = findSheetRoot(
    parseSvg(path.join(projectRoot, curated.figmaMap.sheets.L.file)),
  );
  const purple = getSourceScheme(curated.palettes);
  const orange = curated.palettes.schemes.find((scheme) => scheme.id === 'orange');
  if (!orange) {
    throw new Error('Missing orange palette for the diagonal substrate');
  }

  const confetti = extractSubstrate(
    libraryRoot,
    curated.figmaMap.substrates.L.confetti ?? ['Фон'],
    purple,
    true,
    'confetti',
  );
  const diagonal = extractSubstrate(
    libraryRoot,
    curated.figmaMap.substrates.L.diagonal ?? ['Фон_3'],
    orange,
    false,
    'diagonal',
  );

  const buildFormats = (data: {
    origin: [number, number];
    elements: SubstrateElementData[];
  }): Record<FormatId, SubstrateFormatData> => {
    const square: SubstrateFormatData = {
      width: FRAME_SIZE.width,
      height: FRAME_SIZE.height,
      origin: data.origin,
      elements: data.elements,
    };
    const formats = {} as Record<FormatId, SubstrateFormatData>;
    for (const format of FORMAT_IDS) {
      formats[format] = format === 'square' ? square : cloneFormat(square, true);
    }
    return formats;
  };

  return [
    { id: 'confetti', formats: buildFormats(confetti) },
    { id: 'diagonal', formats: buildFormats(diagonal) },
  ];
}

export function writeSubstrates(
  projectRoot: string,
  substrates: readonly GeneratedSubstrate[],
): void {
  const substratesDir = path.join(projectRoot, 'data', 'generated', 'substrates');
  rmSync(substratesDir, { recursive: true, force: true });
  mkdirSync(substratesDir, { recursive: true });
  for (const substrate of substrates) {
    writeFileSync(
      path.join(substratesDir, `${substrate.id}.json`),
      `${JSON.stringify(substrate, null, 2)}\n`,
      'utf8',
    );
  }
}

export interface SubstrateOracleElement {
  geometry: string;
  position: [number, number];
  end?: [number, number];
  fill: string;
  stroke: string;
}

export function substrateTealOracle(
  projectRoot: string,
  curated: CuratedData,
): { expected: SubstrateOracleElement[]; actual: SubstrateOracleElement[] } {
  const libraryRoot = findSheetRoot(
    parseSvg(path.join(projectRoot, curated.figmaMap.sheets.L.file)),
  );
  const purple = getSourceScheme(curated.palettes);
  const teal = curated.palettes.schemes.find((scheme) => scheme.id === 'teal');
  if (!teal) throw new Error('Missing teal palette');

  const purpleConfetti = extractSubstrate(
    libraryRoot,
    curated.figmaMap.substrates.L.confetti ?? ['Фон'],
    purple,
    true,
    'confetti',
  );
  const tealGroup = extractSubstrate(
    libraryRoot,
    curated.figmaMap.substrates.L.tealCrossCheck ?? ['Фон_2'],
    teal,
    true,
    'confetti',
  );

  const slotToTeal = new Map<Slot, string>();
  for (const slot of Object.keys(purple.slots) as Slot[]) {
    const tealHex = teal.slots[slot];
    if (tealHex) slotToTeal.set(slot, tealHex.toUpperCase());
  }

  const signature = (
    elements: readonly SubstrateElementData[],
    origin: [number, number],
    map: (slot: Slot | undefined) => string,
  ): SubstrateOracleElement[] =>
    elements.map((element) => {
      const fill = element.fill ? map(element.fill) : '';
      const stroke = element.stroke ? map(element.stroke) : '';
      let geometry: string;
      let position: [number, number];
      if (element.tag === 'path' && element.d) {
        const signature = pathSignature(element.d);
        const bbox = pathBBox(element.d);
        geometry = `path:${signature ? signature.hash : element.d}`;
        position = [bbox[0] - origin[0], bbox[1] - origin[1]];
      } else if (element.tag === 'rect') {
        geometry = `rect:${element.width}x${element.height}`;
        position = [0, 0];
      } else {
        geometry = 'line';
        position = [(element.x1 ?? 0) - origin[0], (element.y1 ?? 0) - origin[1]];
      }
      const end: [number, number] | undefined =
        element.tag === 'line'
          ? [(element.x2 ?? 0) - origin[0], (element.y2 ?? 0) - origin[1]]
          : undefined;
      return { geometry, position, ...(end ? { end } : {}), fill, stroke };
    });

  const expected = signature(purpleConfetti.elements, purpleConfetti.origin, (slot) => {
    if (!slot) return '';
    if (slot === 'white') return '#FFFFFF';
    return slotToTeal.get(slot) ?? slot;
  });
  const actual = signature(tealGroup.elements, tealGroup.origin, (slot) => {
    if (!slot) return '';
    if (slot === 'white') return '#FFFFFF';
    return teal.slots[slot].toUpperCase();
  });

  return { expected, actual };
}
