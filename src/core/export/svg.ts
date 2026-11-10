import { objectById, paletteFor, variantFor, type Catalog, type FragmentMap } from '../catalog';
import { instanceMatrix, matrixToSvg, multiply, round, scale, translate } from '../geometry';
import { FORMATS } from '../layout/formats';
import { recolorFragment, slotColor } from '../recolor';
import type {
  FragmentPath,
  Palette,
  Scene,
  SubstrateElement,
  SubstrateFormat,
  SubstrateVariant,
} from '../types';

export interface ExportContext {
  catalog: Catalog;
  fragments: FragmentMap;
  substrates: readonly SubstrateVariant[];
}

const ID_PREFIX = 'ic1-';

export function exportScene(scene: Scene, context: ExportContext): string {
  const format = FORMATS[scene.format];
  const palette = paletteFor(context.catalog, scene.paletteId);
  const width = format.width;
  const height = format.height;

  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" fill="none">`,
  );
  lines.push(`  <defs>`);
  lines.push(
    `    <clipPath id="${ID_PREFIX}frame"><rect width="${width}" height="${height}"/></clipPath>`,
  );
  lines.push(`  </defs>`);
  lines.push(`  <g id="${ID_PREFIX}canvas" clip-path="url(#${ID_PREFIX}frame)">`);
  lines.push(
    `    <rect id="${ID_PREFIX}background" width="${width}" height="${height}" ` +
      `fill="${slotColor(palette, 'bg-light')}"/>`,
  );

  if (scene.substrate !== 'none') {
    lines.push(...substrateLines(scene, palette, context, width, height));
  }

  lines.push(`    <g id="${ID_PREFIX}scene">`);
  scene.items.forEach((item, index) => {
    const object = objectById(context.catalog, item.objectId);
    const variant = variantFor(object, item.state, scene.size);
    const fragments = context.fragments.get(variant.key);
    if (!fragments) {
      throw new Error(`Missing fragments for ${variant.key}`);
    }
    const matrix = instanceMatrix(scene, item, variant, scene.format);
    const id = `${ID_PREFIX}obj-${index + 1}-${item.objectId}`;
    lines.push(
      `      <g id="${id}" data-instance="${escapeAttribute(item.id)}" ` +
        `data-object="${item.objectId}" data-state="${item.state}" ` +
        `transform="${matrixToSvg(matrix)}">`,
    );
    for (const fragment of fragments) {
      lines.push(`        ${pathElement(fragment, palette)}`);
    }
    lines.push(`      </g>`);
  });
  lines.push(`    </g>`);
  lines.push(`  </g>`);
  lines.push(`</svg>`);
  return `${lines.join('\n')}\n`;
}

function substrateLines(
  scene: Scene,
  palette: Palette,
  context: ExportContext,
  frameWidth: number,
  frameHeight: number,
): string[] {
  const substrate = context.substrates.find((item) => item.id === scene.substrate);
  if (!substrate) {
    throw new Error(`Unknown substrate: ${scene.substrate}`);
  }
  const data = substrate.byFormat[scene.format];
  const transform = substrateTransform(data, frameWidth, frameHeight);
  const lines: string[] = [];
  lines.push(
    `    <g id="${ID_PREFIX}substrate" data-substrate="${substrate.id}" transform="${matrixToSvg(transform)}">`,
  );
  for (const element of data.elements) {
    lines.push(`      ${substrateElement(element, palette)}`);
  }
  lines.push(`    </g>`);
  return lines;
}

function substrateTransform(
  data: SubstrateFormat,
  frameWidth: number,
  frameHeight: number,
): [number, number, number, number, number, number] {
  const origin = translate(-data.origin[0], -data.origin[1]);
  if (!data.fallback) return origin;
  const factor = Math.max(frameWidth / data.width, frameHeight / data.height);
  const offsetX = (frameWidth - data.width * factor) / 2;
  const offsetY = (frameHeight - data.height * factor) / 2;
  return multiply(translate(offsetX, offsetY), multiply(scale(factor), origin));
}

function substrateElement(element: SubstrateElement, palette: Palette): string {
  if (element.tag === 'rect') {
    const attrs = [
      `width="${formatNumber(element.width ?? 0)}"`,
      `height="${formatNumber(element.height ?? 0)}"`,
      `x="${formatNumber(element.x ?? 0)}"`,
      `y="${formatNumber(element.y ?? 0)}"`,
      `fill="${requireSlot(palette, element.fill)}"`,
    ];
    return `<rect ${withAttrs(attrs, element.attrs)}/>`;
  }
  if (element.tag === 'line') {
    const attrs = [
      `x1="${formatNumber(element.x1 ?? 0)}"`,
      `y1="${formatNumber(element.y1 ?? 0)}"`,
      `x2="${formatNumber(element.x2 ?? 0)}"`,
      `y2="${formatNumber(element.y2 ?? 0)}"`,
      `stroke="${requireSlot(palette, element.stroke)}"`,
    ];
    return `<line ${withAttrs(attrs, element.attrs)}/>`;
  }
  const fragment: FragmentPath = {
    d: element.d ?? '',
    ...(element.fill ? { fill: element.fill } : {}),
    ...(element.stroke ? { stroke: element.stroke } : {}),
    ...(element.attrs ? { attrs: element.attrs } : {}),
  };
  return pathElement(fragment, palette);
}

function pathElement(fragment: FragmentPath, palette: Palette): string {
  const colors = recolorFragment(fragment, palette);
  const attrs = [`d="${escapeAttribute(fragment.d)}"`, `fill="${colors.fill ?? 'none'}"`];
  if (colors.stroke) attrs.push(`stroke="${colors.stroke}"`);
  return `<path ${withAttrs(attrs, fragment.attrs)}/>`;
}

function withAttrs(attrs: string[], extra?: Record<string, string>): string {
  if (!extra) return attrs.join(' ');
  for (const [name, value] of Object.entries(extra)) {
    if (!/^[A-Za-z_:][\w:.-]*$/.test(name)) continue;
    attrs.push(`${name}="${escapeAttribute(value)}"`);
  }
  return attrs.join(' ');
}

function requireSlot(palette: Palette, slot: SubstrateElement['fill']): string {
  if (!slot) throw new Error('Substrate element is missing a color slot');
  return slotColor(palette, slot);
}

function formatNumber(value: number): string {
  return String(round(value, 3));
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
