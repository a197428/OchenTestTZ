import { matrixToSvg, round } from '../geometry';
import {
  buildSceneRender,
  type RenderContext,
  type RenderPath,
  type RenderSubstrateElement,
} from '../render';
import type { Scene } from '../types';

export type ExportContext = RenderContext;

const ID_PREFIX = 'ic1-';

export function exportScene(scene: Scene, context: ExportContext): string {
  const render = buildSceneRender(scene, context);
  const width = render.width;
  const height = render.height;

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
      `fill="${render.background}"/>`,
  );

  if (render.substrate) {
    lines.push(
      `    <g id="${ID_PREFIX}substrate" data-substrate="${render.substrate.id}" ` +
        `transform="${matrixToSvg(render.substrate.matrix)}">`,
    );
    for (const element of render.substrate.elements) {
      lines.push(`      ${substrateElement(element)}`);
    }
    lines.push(`    </g>`);
  }

  lines.push(`    <g id="${ID_PREFIX}scene">`);
  render.objects.forEach((object, index) => {
    const id = `${ID_PREFIX}obj-${index + 1}-${object.objectId}`;
    lines.push(
      `      <g id="${id}" data-instance="${escapeAttribute(object.instanceId)}" ` +
        `data-object="${object.objectId}" data-state="${object.state}" ` +
        `transform="${matrixToSvg(object.matrix)}">`,
    );
    for (const path of object.paths) {
      lines.push(`        ${pathElement(path)}`);
    }
    lines.push(`      </g>`);
  });
  lines.push(`    </g>`);
  lines.push(`  </g>`);
  lines.push(`</svg>`);
  return `${lines.join('\n')}\n`;
}

function substrateElement(element: RenderSubstrateElement): string {
  if (element.tag === 'rect') {
    const attrs = [
      `width="${formatNumber(element.width ?? 0)}"`,
      `height="${formatNumber(element.height ?? 0)}"`,
      `x="${formatNumber(element.x ?? 0)}"`,
      `y="${formatNumber(element.y ?? 0)}"`,
      `fill="${element.fill ?? 'none'}"`,
    ];
    return `<rect ${withAttrs(attrs, element.attrs)}/>`;
  }
  if (element.tag === 'line') {
    const attrs = [
      `x1="${formatNumber(element.x1 ?? 0)}"`,
      `y1="${formatNumber(element.y1 ?? 0)}"`,
      `x2="${formatNumber(element.x2 ?? 0)}"`,
      `y2="${formatNumber(element.y2 ?? 0)}"`,
      `stroke="${element.stroke ?? 'none'}"`,
    ];
    return `<line ${withAttrs(attrs, element.attrs)}/>`;
  }
  const path: RenderPath = {
    d: element.d ?? '',
    ...(element.fill ? { fill: element.fill } : {}),
    ...(element.stroke ? { stroke: element.stroke } : {}),
    ...(element.attrs ? { attrs: element.attrs } : {}),
  };
  return pathElement(path);
}

function pathElement(path: RenderPath): string {
  const attrs = [`d="${escapeAttribute(path.d)}"`, `fill="${path.fill ?? 'none'}"`];
  if (path.stroke) attrs.push(`stroke="${path.stroke}"`);
  return `<path ${withAttrs(attrs, path.attrs)}/>`;
}

function withAttrs(attrs: string[], extra?: Record<string, string>): string {
  if (!extra) return attrs.join(' ');
  for (const [name, value] of Object.entries(extra)) {
    if (!/^[A-Za-z_:][\w:.-]*$/.test(name)) continue;
    attrs.push(`${name}="${escapeAttribute(value)}"`);
  }
  return attrs.join(' ');
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
