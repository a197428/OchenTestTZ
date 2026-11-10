import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { exportScene } from '../../src/core/export/svg';
import { lintExport } from '../../src/core/export/lint';
import { createScene } from '../../src/core/scene';
import type { Instance } from '../../src/core/types';
import {
  allowedPathData,
  loadCatalog,
  loadFragments,
  loadSubstrates,
  readJson,
  readSource,
} from '../helpers/assets';
import type { TemplatesFile } from '../../scripts/ingest/examples';
import { fixId } from '../../scripts/ingest/svg';

const catalog = loadCatalog();
const fragments = loadFragments(catalog);
const substrates = loadSubstrates();
const allowedD = allowedPathData(catalog);
const templates = readJson<TemplatesFile>('templates.json');
const examplesSvg = readSource('data/source/examples/composition-examples.svg');

describe('reproduce composition examples', () => {
  it('renders every template close to the source frame', () => {
    const document = new DOMParser().parseFromString(examplesSvg, 'image/svg+xml');
    const rootSvg = document.documentElement;
    expect(rootSvg).not.toBeNull();
    const defs = findChild(rootSvg!, 'defs');
    const defsXml = defs ? new XMLSerializer().serializeToString(defs) : '';
    const serializer = new XMLSerializer();

    const ratios: Record<string, number> = {};

    for (const template of templates.templates) {
      const frame = findById(rootSvg!, template.frameId);
      expect(frame, `frame ${template.frameId}`).not.toBeNull();
      const rect = findChild(frame!, 'rect');
      expect(rect).not.toBeNull();
      const width = Number(rect!.getAttribute('width'));
      const height = Number(rect!.getAttribute('height'));
      const origin = parseOrigin(rect!.getAttribute('transform'));

      let scene = createScene(template.format, 'purple', template.substrate);
      scene = { ...scene, size: 'L', items: template.items.map(toInstance) };
      const svg = exportScene(scene, { catalog, fragments, substrates });
      const lint = lintExport(svg, { width, height, allowedD });
      expect(lint.errors, template.id).toEqual([]);

      const expectedPng = render(svg, width);
      const sourceFrame =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
        `viewBox="${origin[0]} ${origin[1]} ${width} ${height}">` +
        `<defs>${defsXml}</defs>` +
        `${serializer.serializeToString(frame!)}</svg>`;
      const actualPng = render(sourceFrame, width);

      const ratio = diffRatio(expectedPng, actualPng);
      ratios[template.id] = ratio;
    }

    console.log('reproduction diff ratios', ratios);
    for (const [id, ratio] of Object.entries(ratios)) {
      // Scene 2 uses a deliberate per-object recolor of the wallet that the
      // current palette-only model does not reproduce (see DECISIONS D-017).
      const limit = id.startsWith('scene-2-') ? 0.3 : 0.03;
      expect(ratio, id).toBeLessThanOrEqual(limit);
    }
  });
});

function toInstance(item: TemplatesFile['templates'][number]['items'][number]): Instance {
  return {
    id: `${item.objectId}-${item.state}`,
    objectId: item.objectId,
    state: item.state,
    x: item.x,
    y: item.y,
    rotation: 0,
  };
}

function render(svg: string, width: number): PNG {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
  });
  const png = resvg.render().asPng();
  return PNG.sync.read(Buffer.from(png));
}

function diffRatio(left: PNG, right: PNG): number {
  if (left.width !== right.width || left.height !== right.height) return 1;
  let different = 0;
  const total = left.width * left.height;
  for (let index = 0; index < left.data.length; index += 4) {
    const dr = Math.abs(left.data[index]! - right.data[index]!);
    const dg = Math.abs(left.data[index + 1]! - right.data[index + 1]!);
    const db = Math.abs(left.data[index + 2]! - right.data[index + 2]!);
    const da = Math.abs(left.data[index + 3]! - right.data[index + 3]!);
    if (Math.max(dr, dg, db, da) > 32) different++;
  }
  return different / total;
}

function findChild(element: Element, tag: string): Element | null {
  for (let index = 0; index < element.childNodes.length; index++) {
    const child = element.childNodes.item(index);
    if (child && child.nodeType === 1 && (child as Element).tagName === tag) {
      return child as Element;
    }
  }
  return null;
}

function findById(root: Element, id: string): Element | null {
  let found: Element | null = null;
  const walk = (element: Element): void => {
    if (found) return;
    if (fixId(element.getAttribute('id')) === id) {
      found = element;
      return;
    }
    for (let index = 0; index < element.childNodes.length; index++) {
      const child = element.childNodes.item(index);
      if (child && child.nodeType === 1) walk(child as Element);
    }
  };
  walk(root);
  return found;
}

function parseOrigin(transform: string | null): [number, number] {
  const match = transform ? /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(transform) : null;
  return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0)];
}
