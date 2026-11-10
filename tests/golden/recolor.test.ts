import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { shapeDistance, shapeSignature, type ShapeSignature } from '../../scripts/ingest/svg';
import type { Catalog, CatalogVariant } from '../../src/core/catalog';
import { paletteFor } from '../../src/core/catalog';
import type { FragmentPath } from '../../src/core/types';
import { loadCatalog, loadFragments, readSource } from '../helpers/assets';

const catalog = loadCatalog();
const fragments = loadFragments(catalog);

interface DropPath {
  d: string;
  fill: string;
  stroke: string;
}

interface MatchResult {
  objectId: string;
  state: string;
  size: string;
  matched: number;
  total: number;
  colorMatched: number;
}

describe.each([
  {
    label: 'assembled-L (orange)',
    file: 'data/source/reference-drop/assembled-L.svg',
    paletteId: 'orange',
    minObjects: 6,
    minMatched: 300,
  },
  {
    label: 'assembled-S (teal)',
    file: 'data/source/reference-drop/assembled-S.svg',
    paletteId: 'teal',
    minObjects: 3,
    minMatched: 150,
  },
])('reference-drop recolor oracle: $label', ({ file, paletteId, minObjects, minMatched }) => {
  it('reproduces the designer colors for every matched object', () => {
    const palette = paletteFor(catalog, paletteId);
    const drop = parseDrop(file);
    const variants = allVariants(catalog);
    const results: MatchResult[] = [];

    for (const { objectId, variant } of variants) {
      const fragmentsForVariant = fragments.get(variant.key);
      if (!fragmentsForVariant) continue;
      const entries = buildEntries(fragmentsForVariant);
      const matches = matchDrop(drop, entries);
      if (matches.length < 5) continue;

      let colorMatched = 0;
      let colorCompared = 0;
      for (const match of matches) {
        const source = drop[match.source]!;
        const fragment = fragmentsForVariant[match.target]!;
        const slot = fragment.fill ?? fragment.stroke;
        const actual = normalizeColor(source.fill || source.stroke);
        if (!slot || !actual.startsWith('#')) continue;
        colorCompared++;
        if (actual === (palette.slots[slot] ?? '').toUpperCase()) colorMatched++;
      }

      const coverage = matches.length / entries.length;
      if (coverage < 0.25) continue;
      results.push({
        objectId,
        state: variant.state,
        size: variant.size,
        matched: colorCompared,
        total: entries.length,
        colorMatched,
      });
    }

    const byObject = new Map<string, MatchResult[]>();
    for (const result of results) {
      const list = byObject.get(result.objectId) ?? [];
      list.push(result);
      byObject.set(result.objectId, list);
    }

    const failures: string[] = [];
    let matchedObjects = 0;
    for (const [objectId, candidates] of byObject) {
      const best = candidates.sort(
        (a, b) => b.colorMatched / b.matched - a.colorMatched / a.matched || b.matched - a.matched,
      )[0]!;
      if (best.colorMatched !== best.matched) {
        failures.push(
          `${objectId}.${best.state}: ${best.colorMatched}/${best.matched} colors match`,
        );
      } else {
        matchedObjects++;
      }
    }

    expect(drop.length).toBeGreaterThan(100);
    expect(matchedObjects).toBeGreaterThanOrEqual(minObjects);
    expect(failures).toEqual([]);

    const bestResults = [...byObject.values()].map(
      (candidates) =>
        candidates.sort(
          (a, b) =>
            b.colorMatched / b.matched - a.colorMatched / a.matched || b.matched - a.matched,
        )[0]!,
    );
    const totalMatched = bestResults.reduce((sum, result) => sum + result.matched, 0);
    expect(totalMatched).toBeGreaterThanOrEqual(minMatched);
  });
});

function parseDrop(file: string): DropPath[] {
  const document = new DOMParser().parseFromString(readSource(file), 'image/svg+xml');
  const root = document.documentElement;
  if (!root) return [];
  const result: DropPath[] = [];
  const walk = (node: Element): void => {
    if (node.tagName === 'path') {
      const d = node.getAttribute('d');
      if (d) {
        result.push({
          d,
          fill: node.getAttribute('fill') ?? '',
          stroke: node.getAttribute('stroke') ?? '',
        });
      }
    }
    for (let index = 0; index < node.childNodes.length; index++) {
      const child = node.childNodes.item(index);
      if (child && child.nodeType === 1) walk(child as Element);
    }
  };
  walk(root);
  return result;
}

function allVariants(catalogData: Catalog): { objectId: string; variant: CatalogVariant }[] {
  const result: { objectId: string; variant: CatalogVariant }[] = [];
  for (const object of catalogData.objects) {
    for (const variant of object.variants) {
      result.push({ objectId: object.id, variant });
    }
  }
  return result;
}

interface Entry {
  index: number;
  sig: ShapeSignature;
  key: string;
}

function buildEntries(fragmentsForVariant: readonly FragmentPath[]): Entry[] {
  const entries: Entry[] = [];
  fragmentsForVariant.forEach((fragment, index) => {
    const sig = shapeSignature(fragment.d, 32, 3);
    if (!sig) return;
    entries.push({
      index,
      sig,
      key: sig.samples.map((value) => Math.round(value * 10)).join(','),
    });
  });
  return entries;
}

function matchDrop(
  drop: readonly DropPath[],
  entries: readonly Entry[],
): { source: number; target: number }[] {
  const byKey = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = byKey.get(entry.key);
    if (list) list.push(entry);
    else byKey.set(entry.key, [entry]);
  }

  const used = new Set<number>();
  const matches: { source: number; target: number }[] = [];
  drop.forEach((path, sourceIndex) => {
    const sig = shapeSignature(path.d, 32, 3);
    if (!sig) return;
    const candidates = byKey.get(sig.samples.map((value) => Math.round(value * 10)).join(','));
    if (!candidates) return;
    let best: { entry: Entry; distance: number } | null = null;
    for (const entry of candidates) {
      if (used.has(entry.index)) continue;
      const distance = shapeDistance(sig, entry.sig);
      if (distance > 0.02) continue;
      if (!best || distance < best.distance) best = { entry, distance };
    }
    if (best) {
      used.add(best.entry.index);
      matches.push({ source: sourceIndex, target: best.entry.index });
    }
  });
  return matches;
}

function normalizeColor(value: string): string {
  if (!value) return '';
  if (value.toLowerCase() === 'white') return '#FFFFFF';
  return value.toUpperCase();
}
