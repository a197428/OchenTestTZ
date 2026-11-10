import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GeneratedCatalog } from '../../scripts/ingest/library';
import { BG_SLOTS, SLOTS } from '../../src/core/slots';
import type { FragmentPath, Slot } from '../../src/core/types';

const projectRoot = process.cwd();
const catalogPath = path.join(projectRoot, 'data', 'generated', 'catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as GeneratedCatalog;

function loadFragment(file: string): FragmentPath[] {
  return JSON.parse(
    readFileSync(path.join(projectRoot, 'data', 'generated', file), 'utf8'),
  ) as FragmentPath[];
}

describe('generated catalog', () => {
  it('contains all ten objects with main and bg variants', () => {
    expect(catalog.objects).toHaveLength(10);
    for (const object of catalog.objects) {
      const states = new Set(object.variants.map((variant) => variant.state));
      expect(states).toEqual(new Set(['main', 'bg']));
    }
  });

  it('has unique variant keys and readable layer keys', () => {
    const keys = catalog.objects.flatMap((object) => object.variants.map((variant) => variant.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z]+\.(main|bg)\.[LS]$/);
    }
  });

  it('marks aliases with both sizes and stores the drawing once', () => {
    const aliases = catalog.objects.flatMap((object) =>
      object.variants.filter((variant) => variant.sizes.length > 1),
    );
    expect(aliases.length).toBeGreaterThan(0);
    for (const variant of aliases) {
      expect(variant.sizes).toEqual(['S', 'L']);
      expect(variant.size).toBe('L');
    }
  });

  it('keeps every fragment path verbatim and slot-only', () => {
    const slots = new Set<Slot>(SLOTS);
    for (const object of catalog.objects) {
      for (const variant of object.variants) {
        const fragments = loadFragment(variant.file);
        expect(fragments.length).toBe(variant.pathCount);
        for (const fragment of fragments) {
          expect(fragment.d.length).toBeGreaterThan(0);
          expect(fragment.d).not.toContain('<');
          expect(fragment.d).not.toContain('>');
          for (const slot of [fragment.fill, fragment.stroke]) {
            if (slot) expect(slots.has(slot)).toBe(true);
          }
          expect(fragment.attrs?.['style']).toBeUndefined();
          expect(fragment.attrs?.['class']).toBeUndefined();
        }
      }
    }
  });

  it('uses only background slots for background objects', () => {
    const bgSlots = new Set<Slot>(BG_SLOTS);
    for (const object of catalog.objects) {
      for (const variant of object.variants.filter((item) => item.state === 'bg')) {
        for (const fragment of loadFragment(variant.file)) {
          for (const slot of [fragment.fill, fragment.stroke]) {
            if (slot) expect(bgSlots.has(slot)).toBe(true);
          }
        }
      }
    }
  });

  it('stores finite transforms, positive bboxes and bounded hulls', () => {
    for (const object of catalog.objects) {
      for (const variant of object.variants) {
        for (const value of variant.toNative) expect(Number.isFinite(value)).toBe(true);
        expect(variant.bbox.w).toBeGreaterThan(0);
        expect(variant.bbox.h).toBeGreaterThan(0);
        expect(variant.hull.length).toBeGreaterThanOrEqual(3);
        expect(variant.hull.length).toBeLessThanOrEqual(64);
      }
    }
  });

  it('ships the three built-in palettes', () => {
    expect(catalog.palettes.map((palette) => palette.id)).toEqual(['purple', 'orange', 'teal']);
    for (const palette of catalog.palettes) {
      for (const slot of SLOTS) {
        expect(palette.slots[slot]).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });
});
