import { SLOTS } from './slots';
import type {
  DetailSize,
  FragmentPath,
  Matrix,
  ObjectId,
  ObjectState,
  Palette,
  Slot,
} from './types';

export interface CatalogVariant {
  key: string;
  state: ObjectState;
  size: DetailSize;
  sizes: DetailSize[];
  file: string;
  toNative: Matrix;
  bbox: { w: number; h: number };
  hull: [number, number][];
  geometryHash: string;
  pathCount: number;
  fit?: { matched: number; total: number; scale: number; rms: number };
}

export interface CatalogObject {
  id: ObjectId;
  nameRu: string;
  nameEn: string;
  meta: { synonyms: string[]; tags: string[]; heroWeight: number };
  variants: CatalogVariant[];
}

export interface Catalog {
  version: 1;
  source?: {
    library: Record<DetailSize, string>;
    palettes: string;
  };
  objects: CatalogObject[];
  palettes: Palette[];
}

export type FragmentMap = ReadonlyMap<string, readonly FragmentPath[]>;

export function objectById(catalog: Catalog, id: ObjectId): CatalogObject {
  const object = catalog.objects.find((candidate) => candidate.id === id);
  if (!object) {
    throw new Error(`Unknown catalog object: ${id}`);
  }
  return object;
}

export function variantFor(
  object: CatalogObject,
  state: ObjectState,
  size: DetailSize,
): CatalogVariant {
  const candidates = object.variants.filter(
    (variant) => variant.state === state && variant.sizes.includes(size),
  );
  if (candidates.length === 0) {
    throw new Error(`No ${state}/${size} variant for ${object.id}`);
  }
  const exact = candidates.find((variant) => variant.size === size);
  return exact ?? candidates[0]!;
}

export function paletteFor(catalog: Catalog, paletteId: string): Palette {
  const palette = catalog.palettes.find((candidate) => candidate.id === paletteId);
  if (!palette) {
    throw new Error(`Unknown palette: ${paletteId}`);
  }
  return palette;
}

export function parseCatalog(raw: unknown): Catalog {
  if (!isRecord(raw)) throw new Error('Catalog must be an object');
  if (raw.version !== 1) throw new Error('Unsupported catalog version');
  if (!Array.isArray(raw.objects)) throw new Error('Catalog objects must be an array');
  if (!Array.isArray(raw.palettes)) throw new Error('Catalog palettes must be an array');

  const objects = raw.objects.map((value, index) => parseObject(value, index));
  const ids = new Set(objects.map((object) => object.id));
  if (ids.size !== objects.length) throw new Error('Duplicate catalog object ids');

  const palettes = raw.palettes.map((value, index) => parsePalette(value, index));
  return {
    version: 1,
    ...(isRecord(raw.source) ? { source: raw.source as Catalog['source'] } : {}),
    objects,
    palettes,
  };
}

function parseObject(raw: unknown, index: number): CatalogObject {
  if (!isRecord(raw)) throw new Error(`Object ${index} must be an object`);
  if (typeof raw.id !== 'string') throw new Error(`Object ${index} has no id`);
  if (typeof raw.nameRu !== 'string' || typeof raw.nameEn !== 'string') {
    throw new Error(`Object ${raw.id} has no names`);
  }
  if (!isRecord(raw.meta)) throw new Error(`Object ${raw.id} has no meta`);
  if (!Array.isArray(raw.variants) || raw.variants.length === 0) {
    throw new Error(`Object ${raw.id} has no variants`);
  }
  return {
    id: raw.id as ObjectId,
    nameRu: raw.nameRu,
    nameEn: raw.nameEn,
    meta: {
      synonyms: parseStringArray(raw.meta.synonyms, `${raw.id}.synonyms`),
      tags: parseStringArray(raw.meta.tags, `${raw.id}.tags`),
      heroWeight: typeof raw.meta.heroWeight === 'number' ? raw.meta.heroWeight : 1,
    },
    variants: raw.variants.map((variant, variantIndex) =>
      parseVariant(variant, `${raw.id}[${variantIndex}]`),
    ),
  };
}

function parseVariant(raw: unknown, context: string): CatalogVariant {
  if (!isRecord(raw)) throw new Error(`Variant ${context} must be an object`);
  if (typeof raw.key !== 'string' || typeof raw.file !== 'string') {
    throw new Error(`Variant ${context} has no key/file`);
  }
  if (raw.state !== 'main' && raw.state !== 'bg') {
    throw new Error(`Variant ${context} has invalid state`);
  }
  if (raw.size !== 'S' && raw.size !== 'L') {
    throw new Error(`Variant ${context} has invalid size`);
  }
  const sizes = parseSizes(raw.sizes, context);
  const toNative = parseMatrix(raw.toNative, context);
  const bbox = raw.bbox;
  if (!isRecord(bbox) || typeof bbox.w !== 'number' || typeof bbox.h !== 'number') {
    throw new Error(`Variant ${context} has invalid bbox`);
  }
  if (!Array.isArray(raw.hull)) throw new Error(`Variant ${context} has no hull`);
  return {
    key: raw.key,
    state: raw.state,
    size: raw.size,
    sizes,
    file: raw.file,
    toNative,
    bbox: { w: bbox.w, h: bbox.h },
    hull: raw.hull as [number, number][],
    geometryHash: typeof raw.geometryHash === 'string' ? raw.geometryHash : '',
    pathCount: typeof raw.pathCount === 'number' ? raw.pathCount : 0,
  };
}

function parsePalette(raw: unknown, index: number): Palette {
  if (!isRecord(raw)) throw new Error(`Palette ${index} must be an object`);
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new Error(`Palette ${index} has no id/name`);
  }
  const rawSlots = raw.slots;
  if (!isRecord(rawSlots)) throw new Error(`Palette ${raw.id} has no slots`);
  const slots = Object.fromEntries(
    SLOTS.map((slot) => {
      const value = rawSlots[slot as Slot];
      if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
        throw new Error(`Palette ${raw.id} slot ${slot} is invalid`);
      }
      return [slot, value.toUpperCase()];
    }),
  ) as Record<Slot, string>;
  return {
    id: raw.id,
    name: raw.name,
    builtin: raw.builtin === true,
    slots,
  };
}

function parseSizes(value: unknown, context: string): DetailSize[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Variant ${context} has invalid sizes`);
  }
  return value.map((size) => {
    if (size !== 'S' && size !== 'L') throw new Error(`Variant ${context} has invalid size`);
    return size;
  });
}

function parseMatrix(value: unknown, context: string): Matrix {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    !value.every((item) => typeof item === 'number')
  ) {
    throw new Error(`Variant ${context} has invalid matrix`);
  }
  return value as Matrix;
}

function parseStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Invalid string array: ${context}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
