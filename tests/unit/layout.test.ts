import { describe, expect, it } from 'vitest';
import { variantFor } from '../../src/core/catalog';
import { FORMATS } from '../../src/core/layout/formats';
import { layout } from '../../src/core/layout/layout';
import { pairKey, placementHull, type ScoreContext } from '../../src/core/layout/score';
import type { LayoutItemRequest, TemplateData } from '../../src/core/layout/types';
import { bboxOfPoints, polygonsOverlap } from '../../src/core/geometry';
import type { Scene } from '../../src/core/types';
import { loadCatalog, loadLayoutData } from '../helpers/assets';

const catalog = loadCatalog();
const data = loadLayoutData();
const relations = new Set(data.relations.map((relation) => pairKey(relation.from, relation.to)));

function requestFor(template: TemplateData): LayoutItemRequest[] {
  return template.items.map((item) => ({ objectId: item.objectId, state: item.state }));
}

describe('layout from authored templates', () => {
  it('reproduces all 18 example arrangements', () => {
    let reproduced = 0;
    for (const template of data.templates) {
      const scene = layout(
        {
          items: requestFor(template),
          format: template.format,
          size: 'L',
          seed: 7,
          paletteId: 'purple',
          substrate: template.substrate,
        },
        catalog,
        data,
      );
      expect(scene.items).toHaveLength(template.items.length);
      for (const expected of template.items) {
        const actual = scene.items.find((item) => item.objectId === expected.objectId);
        expect(actual).toBeDefined();
        expect(actual!.state).toBe(expected.state);
        expect(actual!.x).toBeCloseTo(expected.x, 3);
        expect(actual!.y).toBeCloseTo(expected.y, 3);
        expect(actual!.rotation).toBe(0);
      }
      const zOrder = [...scene.items].map((item) => item.objectId);
      const expectedOrder = [...template.items]
        .sort((a, b) => a.z - b.z)
        .map((item) => item.objectId);
      expect(zOrder).toEqual(expectedOrder);
      reproduced++;
    }
    expect(reproduced).toBe(18);
  });
});

describe('deterministic generator', () => {
  const sets: LayoutItemRequest[][] = [
    [{ objectId: 'book' }, { objectId: 'lamp' }, { objectId: 'pen' }],
    [{ objectId: 'phone' }, { objectId: 'wallet' }, { objectId: 'coin' }, { objectId: 'folder' }],
    [{ objectId: 'tulips' }, { objectId: 'puzzle' }],
    [{ objectId: 'headphones' }, { objectId: 'book' }, { objectId: 'coin' }],
    [{ objectId: 'lamp' }, { objectId: 'tulips' }, { objectId: 'wallet' }],
    [
      { objectId: 'book' },
      { objectId: 'phone' },
      { objectId: 'puzzle' },
      { objectId: 'coin' },
      { objectId: 'headphones' },
      { objectId: 'lamp' },
    ],
    [{ objectId: 'book' }],
  ];

  it('is deterministic for a seed and varies across seeds', () => {
    for (const items of sets) {
      const a = layout({ items, format: 'square', size: 'L', seed: 11 }, catalog, data);
      const b = layout({ items, format: 'square', size: 'L', seed: 11 }, catalog, data);
      expect(a).toEqual(b);
    }
    const a = layout({ items: sets[0]!, format: 'square', size: 'L', seed: 11 }, catalog, data);
    const b = layout({ items: sets[0]!, format: 'square', size: 'L', seed: 12 }, catalog, data);
    expect(a).not.toEqual(b);
  });

  it('never creates forbidden overlaps and respects the frame', () => {
    for (const items of sets) {
      for (const format of ['square', 'wide', 'tall'] as const) {
        for (const seed of [1, 2, 3]) {
          const scene = layout({ items, format, size: 'L', seed }, catalog, data);
          expectValidScene(scene, items, format);
        }
      }
    }
  });

  it('keeps the left headline zone clear', () => {
    for (const format of ['square', 'wide', 'tall'] as const) {
      const scene = layout(
        {
          items: [{ objectId: 'book' }, { objectId: 'phone' }, { objectId: 'lamp' }],
          format,
          size: 'L',
          seed: 5,
          headlineSpace: 'left',
        },
        catalog,
        data,
      );
      const context = contextFor(scene);
      for (const item of scene.items) {
        if (item.state === 'bg') continue;
        const object = catalog.objects.find((candidate) => candidate.id === item.objectId)!;
        const variant = variantFor(object, item.state, scene.size);
        const hull = placementHull(
          {
            objectId: item.objectId,
            state: item.state,
            role: 'support',
            x: item.x,
            y: item.y,
            hull: variant.hull,
            bbox: variant.bbox,
          },
          context,
        );
        const box = bboxOfPoints(hull);
        expect(box[0]).toBeGreaterThanOrEqual(FORMATS[format].width * 0.3);
      }
    }
  });

  it('uses both main and generated backdrop states when asked', () => {
    const scene = layout(
      {
        items: [{ objectId: 'headphones' }, { objectId: 'tulips' }],
        format: 'wide',
        size: 'L',
        seed: 3,
        backdrop: 'on',
      },
      catalog,
      data,
    );
    const states = scene.items.map((item) => item.state);
    expect(states).toContain('main');
    expect(states).toContain('bg');
    const firstMain = scene.items.findIndex((item) => item.state === 'main');
    const lastBackdrop = scene.items
      .map((item, index) => (item.state === 'bg' ? index : -1))
      .reduce((max, index) => Math.max(max, index), -1);
    expect(lastBackdrop).toBeLessThan(firstMain);
  });
});

function expectValidScene(
  scene: Scene,
  request: readonly LayoutItemRequest[],
  format: keyof typeof FORMATS,
): void {
  expect(scene.items.length).toBeGreaterThanOrEqual(request.length);
  expect(scene.items.length).toBeLessThanOrEqual(request.length + 1);
  expect(scene.scale).toBeGreaterThanOrEqual(0.3);
  expect(scene.scale).toBeLessThanOrEqual(1.5);
  const requested = new Set(request.map((item) => item.objectId));
  for (const item of scene.items) {
    expect(catalog.objects.some((object) => object.id === item.objectId)).toBe(true);
    if (item.state === 'main') expect(requested.has(item.objectId)).toBe(true);
    expect(item.rotation).toBe(0);
  }

  const context = contextFor(scene);
  const main = scene.items.filter((item) => item.state === 'main');
  const hulls = main.map((item) => {
    const object = catalog.objects.find((candidate) => candidate.id === item.objectId)!;
    const variant = variantFor(object, item.state, scene.size);
    return {
      item,
      hull: placementHull(
        {
          objectId: item.objectId,
          state: item.state,
          role: 'support',
          x: item.x,
          y: item.y,
          hull: variant.hull,
          bbox: variant.bbox,
        },
        context,
      ),
    };
  });

  for (let i = 0; i < hulls.length; i++) {
    for (let j = i + 1; j < hulls.length; j++) {
      const a = hulls[i]!;
      const b = hulls[j]!;
      if (relations.has(pairKey(a.item.objectId, b.item.objectId))) continue;
      expect(
        polygonsOverlap(a.hull, b.hull),
        `${format}: ${a.item.objectId} overlaps ${b.item.objectId}`,
      ).toBe(false);
    }
  }

  const frame = FORMATS[format];
  for (const { hull } of hulls) {
    const box = bboxOfPoints(hull);
    expect(box[2]).toBeGreaterThan(0);
    expect(box[0]).toBeLessThan(frame.width);
    expect(box[3]).toBeGreaterThan(0);
    expect(box[1]).toBeLessThan(frame.height);
  }
}

function contextFor(scene: Scene): ScoreContext {
  const frame = FORMATS[scene.format];
  return {
    frameWidth: frame.width,
    frameHeight: frame.height,
    sceneScale: scene.scale,
    headlineSpace: 'none',
    relatedPairs: relations,
    stats: data.stats.byFormat[scene.format],
  };
}
