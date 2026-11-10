import { describe, expect, it } from 'vitest';
import { variantFor } from '../../src/core/catalog';
import { exportScene } from '../../src/core/export/svg';
import { lintExport } from '../../src/core/export/lint';
import { FORMATS, FORMAT_IDS } from '../../src/core/layout/formats';
import { addItem, createScene, setSceneScale, setSceneSize } from '../../src/core/scene';
import type { Instance, ObjectId, ObjectState, Scene } from '../../src/core/types';
import { allowedPathData, loadCatalog, loadFragments, loadSubstrates } from '../helpers/assets';

const catalog = loadCatalog();
const fragments = loadFragments(catalog);
const substrates = loadSubstrates();
const allowedD = allowedPathData(catalog);

function buildScene(size: 'S' | 'L', substrate: Scene['substrate'] = 'confetti'): Scene {
  let scene = createScene('square', 'purple', substrate);
  scene = setSceneSize(scene, size);
  let index = 0;
  for (const object of catalog.objects) {
    for (const state of ['main', 'bg'] as const) {
      const item: Instance = {
        id: `${state}-${object.id}`,
        objectId: object.id as ObjectId,
        state: state as ObjectState,
        x: (index % 5) * 300 - 300,
        y: Math.floor(index / 5) * 300 - 200,
        rotation: 0,
      };
      scene = addItem(scene, item);
      index++;
    }
  }
  return scene;
}

function exportedPathData(svg: string): string[] {
  return [...svg.matchAll(/<path d="([^"]*)"/g)].map((match) => match[1] ?? '');
}

describe('SVG export', () => {
  it('export every object in L size and stays valid', () => {
    const scene = buildScene('L');
    const svg = exportScene(scene, { catalog, fragments, substrates });
    const lint = lintExport(svg, {
      width: 1000,
      height: 1000,
      allowedD,
    });
    expect(lint.errors).toEqual([]);
    expect(svg.match(/<g id="ic1-obj-/g)).toHaveLength(20);
    expect(svg).not.toMatch(/<style|<image|<foreignObject|<filter|<mask|class=/);
    expect(svg).toContain('fill="#FFFFFF"');
    expect(svg).toContain('fill="#D7CDF5"');
  });

  it('keeps every path d byte-identical to the catalog', () => {
    for (const size of ['L', 'S'] as const) {
      const scene = buildScene(size);
      const svg = exportScene(scene, { catalog, fragments, substrates });
      const expected: string[] = [];
      for (const item of scene.items) {
        const object = catalog.objects.find((candidate) => candidate.id === item.objectId)!;
        const variant = variantFor(object, item.state, size);
        expected.push(...(fragments.get(variant.key) ?? []).map((fragment) => fragment.d));
      }
      const substrate = substrates.find((candidate) => candidate.id === scene.substrate);
      if (substrate) {
        for (const element of substrate.byFormat[scene.format].elements) {
          if (element.tag === 'path' && element.d) expected.push(element.d);
        }
      }
      expect(exportedPathData(svg).sort()).toEqual(expected.sort());
    }
  });

  it('exports all formats and substrates at both sizes', () => {
    for (const format of FORMAT_IDS) {
      const frame = FORMATS[format];
      for (const substrate of ['confetti', 'diagonal', 'none'] as const) {
        for (const size of ['L', 'S'] as const) {
          let scene = buildScene(size, substrate);
          scene = { ...scene, format, scale: 0.8 };
          const svg = exportScene(scene, { catalog, fragments, substrates });
          const lint = lintExport(svg, {
            width: frame.width,
            height: frame.height,
            allowedD,
          });
          expect(lint.errors, `${format}/${substrate}/${size}`).toEqual([]);
          expect(svg).toContain(`viewBox="0 0 ${frame.width} ${frame.height}"`);
          if (substrate === 'none') {
            expect(svg).not.toContain('ic1-substrate');
          } else {
            expect(svg).toContain(`data-substrate="${substrate}"`);
          }
        }
      }
    }
  });

  it('applies scene scale and rotation through the object transform', () => {
    let scene = createScene('wide', 'orange', 'diagonal');
    scene = addItem(scene, {
      id: 'a',
      objectId: 'book',
      state: 'main',
      x: 100,
      y: 50,
      rotation: 15,
    });
    scene = setSceneScale(scene, 1.25);
    const svg = exportScene(scene, { catalog, fragments, substrates });
    const transform = /transform="(matrix\([^"]*\))"/.exec(svg)?.[1];
    expect(transform).toBeDefined();
    expect(transform).not.toBe('matrix(1 0 0 1 0 0)');
    expect(lintExport(svg, { width: 1200, height: 630, allowedD }).ok).toBe(true);
  });

  it('recolors every path with the selected palette', () => {
    let scene = createScene('square', 'teal', 'confetti');
    scene = addItem(scene, {
      id: 'book',
      objectId: 'book',
      state: 'main',
      x: 0,
      y: 0,
      rotation: 0,
    });
    const svg = exportScene(scene, { catalog, fragments, substrates });
    expect(svg).toContain('fill="#BEEBEB"');
    expect(svg).not.toContain('fill="#D7CDF5"');
  });

  it('fails clearly when fragments are missing', () => {
    const scene = buildScene('L');
    expect(() => exportScene(scene, { catalog, fragments: new Map(), substrates })).toThrow(
      /Missing fragments/,
    );
  });
});
