import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GeneratedCatalog } from '../../scripts/ingest/library';
import type { RelationsFile, StatsFile, TemplatesFile } from '../../scripts/ingest/examples';

const projectRoot = process.cwd();
const generated = path.join(projectRoot, 'data', 'generated');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(generated, file), 'utf8')) as T;
}

const catalog = readJson<GeneratedCatalog>('catalog.json');
const templates = readJson<TemplatesFile>('templates.json');
const relations = readJson<RelationsFile>('relations.json');
const stats = readJson<StatsFile>('stats.json');

describe('generated templates', () => {
  it('has 18 templates across 6 scenes and 3 formats', () => {
    expect(templates.templates).toHaveLength(18);
    const scenes = new Map<string, Set<string>>();
    const formats = new Map<string, number>();
    for (const template of templates.templates) {
      const set = scenes.get(template.sceneId) ?? new Set<string>();
      set.add(template.format);
      scenes.set(template.sceneId, set);
      formats.set(template.format, (formats.get(template.format) ?? 0) + 1);
    }
    expect(scenes.size).toBe(6);
    for (const set of scenes.values()) {
      expect([...set].sort()).toEqual(['square', 'tall', 'wide']);
    }
    expect(formats.get('square')).toBe(6);
    expect(formats.get('wide')).toBe(6);
    expect(formats.get('tall')).toBe(6);
  });

  it('references existing catalog variants and valid z-order', () => {
    for (const template of templates.templates) {
      expect(template.items.length).toBeGreaterThanOrEqual(2);
      expect(template.items.length).toBeLessThanOrEqual(3);
      expect(new Set(template.items.map((item) => item.z)).size).toBe(template.items.length);
      for (const item of template.items) {
        const object = catalog.objects.find((candidate) => candidate.id === item.objectId);
        expect(object).toBeDefined();
        const variant = object!.variants.find(
          (candidate) => candidate.state === item.state && candidate.sizes.includes(item.size),
        );
        expect(variant).toBeDefined();
        expect(Number.isFinite(item.x)).toBe(true);
        expect(Number.isFinite(item.y)).toBe(true);
        expect(item.x).toBeGreaterThan(-2000);
        expect(item.x).toBeLessThan(2000);
        expect(item.y).toBeGreaterThan(-2000);
        expect(item.y).toBeLessThan(2000);
      }
    }
  });

  it('uses both substrate variants and all three formats', () => {
    const substrates = new Set(templates.templates.map((template) => template.substrate));
    expect(substrates).toEqual(new Set(['confetti', 'diagonal']));
    for (const template of templates.templates) {
      expect(['square', 'wide', 'tall']).toContain(template.format);
    }
  });
});

describe('generated relations', () => {
  it('contains known stacks with finite offsets', () => {
    const keys = relations.relations.map(
      (relation) => `${relation.from}:${relation.fromState}->${relation.to}:${relation.toState}`,
    );
    expect(keys).toContain('phone:main->book:main');
    expect(keys).toContain('puzzle:main->book:bg');
    expect(keys).toContain('headphones:main->tulips:bg');
    for (const relation of relations.relations) {
      expect(relation.offsets.length).toBeGreaterThan(0);
      expect(relation.count).toBeGreaterThanOrEqual(relation.offsets.length);
      for (const [dx, dy] of relation.offsets) {
        expect(Number.isFinite(dx)).toBe(true);
        expect(Number.isFinite(dy)).toBe(true);
      }
    }
  });
});

describe('generated stats', () => {
  it('covers all formats with sane ranges', () => {
    for (const format of ['square', 'wide', 'tall'] as const) {
      const entry = stats.byFormat[format];
      expect(entry).toBeDefined();
      expect(entry.templates).toBe(6);
      expect(entry.cropShare.mean).toBeGreaterThanOrEqual(0);
      expect(entry.cropShare.mean).toBeLessThanOrEqual(0.8);
      expect(entry.density.mean).toBeGreaterThanOrEqual(0);
      expect(entry.density.mean).toBeLessThanOrEqual(1);
      expect(entry.emptyLeft.mean).toBeGreaterThanOrEqual(0);
      expect(entry.emptyLeft.mean).toBeLessThanOrEqual(1);
      expect(entry.minDistance.mean).toBeGreaterThanOrEqual(0);
    }
  });

  it('records no pure object-slot permutations (ASK-03)', () => {
    expect(stats.colorPermutations.filter((change) => change.pureObjPermutation)).toHaveLength(0);
    const wallet = stats.colorPermutations.find((change) => change.objectId === 'wallet');
    expect(wallet).toBeDefined();
    expect(wallet!.pairs).toContainEqual(['bg-light', 'obj-1']);
    expect(wallet!.pairs).toContainEqual(['obj-1', 'obj-2']);
  });
});

describe('generated substrates', () => {
  it('has example-derived data for every format', () => {
    for (const id of ['confetti', 'diagonal'] as const) {
      const substrate = readJson<{
        formats: Record<string, { elements: unknown[]; fallback?: boolean }>;
      }>(`substrates/${id}.json`);
      for (const format of ['square', 'wide', 'tall']) {
        expect(substrate.formats[format]).toBeDefined();
        expect(substrate.formats[format]!.elements.length).toBeGreaterThan(0);
        expect(substrate.formats[format]!.fallback).toBeUndefined();
      }
    }
  });
});
