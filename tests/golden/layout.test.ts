import { describe, expect, it } from 'vitest';
import { layout } from '../../src/core/layout/layout';
import { loadCatalog, loadLayoutData } from '../helpers/assets';

const catalog = loadCatalog();
const data = loadLayoutData();

describe('layout golden metric', () => {
  it('reproduces the authored arrangements', () => {
    const distances: number[] = [];
    let reproduced = 0;

    for (const template of data.templates) {
      const scene = layout(
        {
          items: template.items.map((item) => ({ objectId: item.objectId, state: item.state })),
          format: template.format,
          size: 'L',
          seed: 3,
          paletteId: 'purple',
          substrate: template.substrate,
        },
        catalog,
        data,
      );

      let maxDistance = 0;
      for (const expected of template.items) {
        const actual = scene.items.find((item) => item.objectId === expected.objectId);
        expect(actual).toBeDefined();
        const distance = Math.hypot((actual?.x ?? 0) - expected.x, (actual?.y ?? 0) - expected.y);
        distances.push(distance);
        maxDistance = Math.max(maxDistance, distance);
      }
      if (maxDistance < 1) reproduced++;
    }

    const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    const worst = Math.max(...distances);
    console.log(
      `layout golden: reproduced ${reproduced}/${data.templates.length}, mean error ${mean.toFixed(4)}px, worst ${worst.toFixed(4)}px`,
    );
    expect(reproduced).toBeGreaterThanOrEqual(Math.ceil(data.templates.length / 2));
    expect(mean).toBeLessThan(0.01);
  });
});
