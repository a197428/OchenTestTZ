import { objectById, paletteFor, variantFor, type Catalog, type FragmentMap } from './catalog';
import { instanceMatrix, multiply, scale, translate } from './geometry';
import { FORMATS } from './layout/formats';
import { recolorFragment, slotColor } from './recolor';
import type {
  Matrix,
  Palette,
  Scene,
  SubstrateElement,
  SubstrateFormat,
  SubstrateVariant,
} from './types';

export interface RenderContext {
  catalog: Catalog;
  fragments: FragmentMap;
  substrates: readonly SubstrateVariant[];
}

export interface RenderPath {
  d: string;
  fill?: string;
  stroke?: string;
  attrs?: Record<string, string>;
}

export interface RenderObject {
  instanceId: string;
  objectId: string;
  state: string;
  matrix: Matrix;
  paths: RenderPath[];
}

export interface RenderSubstrateElement {
  tag: 'path' | 'rect' | 'line';
  d?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  fill?: string;
  stroke?: string;
  attrs?: Record<string, string>;
}

export interface RenderSubstrate {
  id: string;
  matrix: Matrix;
  elements: RenderSubstrateElement[];
}

export interface SceneRender {
  width: number;
  height: number;
  background: string;
  palette: Palette;
  substrate: RenderSubstrate | null;
  objects: RenderObject[];
}

export function buildSceneRender(scene: Scene, context: RenderContext): SceneRender {
  const frame = FORMATS[scene.format];
  const palette = paletteFor(context.catalog, scene.paletteId);

  const objects = scene.items.map((item): RenderObject => {
    const object = objectById(context.catalog, item.objectId);
    const variant = variantFor(object, item.state, scene.size);
    const fragments = context.fragments.get(variant.key);
    if (!fragments) {
      throw new Error(`Missing fragments for ${variant.key}`);
    }
    return {
      instanceId: item.id,
      objectId: item.objectId,
      state: item.state,
      matrix: instanceMatrix(scene, item, variant, scene.format),
      paths: fragments.map((fragment) => {
        const colors = recolorFragment(fragment, palette);
        return {
          d: fragment.d,
          ...(colors.fill ? { fill: colors.fill } : {}),
          ...(colors.stroke ? { stroke: colors.stroke } : {}),
          ...(fragment.attrs ? { attrs: fragment.attrs } : {}),
        };
      }),
    };
  });

  return {
    width: frame.width,
    height: frame.height,
    background: slotColor(palette, 'bg-light'),
    palette,
    substrate:
      scene.substrate === 'none'
        ? null
        : buildSubstrate(scene, palette, context, frame.width, frame.height),
    objects,
  };
}

function buildSubstrate(
  scene: Scene,
  palette: Palette,
  context: RenderContext,
  frameWidth: number,
  frameHeight: number,
): RenderSubstrate {
  const substrate = context.substrates.find((item) => item.id === scene.substrate);
  if (!substrate) {
    throw new Error(`Unknown substrate: ${scene.substrate}`);
  }
  const data = substrate.byFormat[scene.format];
  const matrix = substrateTransform(data, frameWidth, frameHeight);
  const elements = data.elements.map((element): RenderSubstrateElement => {
    if (element.tag === 'rect') {
      return {
        tag: 'rect',
        x: element.x ?? 0,
        y: element.y ?? 0,
        width: element.width ?? 0,
        height: element.height ?? 0,
        fill: requireSlot(palette, element.fill),
        ...(element.attrs ? { attrs: element.attrs } : {}),
      };
    }
    if (element.tag === 'line') {
      return {
        tag: 'line',
        x1: element.x1 ?? 0,
        y1: element.y1 ?? 0,
        x2: element.x2 ?? 0,
        y2: element.y2 ?? 0,
        stroke: requireSlot(palette, element.stroke),
        ...(element.attrs ? { attrs: element.attrs } : {}),
      };
    }
    return {
      tag: 'path',
      d: element.d ?? '',
      ...(element.fill ? { fill: slotColor(palette, element.fill) } : {}),
      ...(element.stroke ? { stroke: slotColor(palette, element.stroke) } : {}),
      ...(element.attrs ? { attrs: element.attrs } : {}),
    };
  });
  return { id: substrate.id, matrix, elements };
}

function substrateTransform(
  data: SubstrateFormat,
  frameWidth: number,
  frameHeight: number,
): Matrix {
  const origin = translate(-data.origin[0], -data.origin[1]);
  if (!data.fallback) return origin;
  const factor = Math.max(frameWidth / data.width, frameHeight / data.height);
  const offsetX = (frameWidth - data.width * factor) / 2;
  const offsetY = (frameHeight - data.height * factor) / 2;
  return multiply(translate(offsetX, offsetY), multiply(scale(factor), origin));
}

function requireSlot(palette: Palette, slot: SubstrateElement['fill']): string {
  if (!slot) throw new Error('Substrate element is missing a color slot');
  return slotColor(palette, slot);
}
