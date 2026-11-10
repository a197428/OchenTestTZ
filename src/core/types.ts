export type Slot =
  'bg-light' | 'bg-mid' | 'bg-dark' | 'obj-1' | 'obj-2' | 'obj-3' | 'ink' | 'white';

export type ObjectId =
  | 'book'
  | 'phone'
  | 'puzzle'
  | 'coin'
  | 'headphones'
  | 'lamp'
  | 'tulips'
  | 'wallet'
  | 'folder'
  | 'pen';

export type ObjectState = 'main' | 'bg';

export type DetailSize = 'S' | 'L';

export type FormatId = 'square' | 'wide' | 'tall';

export type Matrix = [number, number, number, number, number, number];

export interface FragmentPath {
  /** Verbatim `d` from the source library. Never transformed. */
  d: string;
  fill?: Slot;
  stroke?: Slot;
  /** Other presentational attributes (stroke-width, fill-opacity, ...), except id. */
  attrs?: Record<string, string>;
}

export interface Variant {
  /** `${objectId}.${state}.${size}` */
  key: string;
  paths: FragmentPath[];
  /** Fragment coordinates to native (sheet L) coordinates. */
  toNative: Matrix;
  /** Bounding box in native units. */
  bbox: { w: number; h: number };
  /** Convex hull in native units, at most 64 points. */
  hull: [number, number][];
  /** Sizes this variant serves; bg objects alias both sizes. */
  sizes: DetailSize[];
  geometryHash: string;
}

export interface CatalogObject {
  id: ObjectId;
  nameRu: string;
  nameEn: string;
  /** Variants by state and size, including aliases. */
  variants: Variant[];
  meta: { synonyms: string[]; tags: string[]; heroWeight: number };
}

export interface Palette {
  id: string;
  name: string;
  builtin?: boolean;
  slots: Record<Slot, string>;
}

export interface SubstrateElement {
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
  fill?: Slot;
  stroke?: Slot;
  attrs?: Record<string, string>;
}

export interface SubstrateFormat {
  /** Native size of the substrate drawing. */
  width: number;
  height: number;
  /** Translation applied to elements so that the frame origin is at (0, 0). */
  origin: [number, number];
  elements: SubstrateElement[];
  /** True when the drawing is cover-scaled from the 1000x1000 library version. */
  fallback?: boolean;
}

export interface SubstrateVariant {
  id: 'confetti' | 'diagonal';
  byFormat: Record<FormatId, SubstrateFormat>;
}

export interface Instance {
  /** Unique id; participates in exported element ids. */
  id: string;
  objectId: ObjectId;
  state: ObjectState;
  /** Position of the native origin in scene units. */
  x: number;
  y: number;
  /** Degrees around the bbox center. Defaults to 0. */
  rotation: number;
  /** Only permutations among obj-1..obj-3 (ASK-03). */
  slotOverride?: Partial<Record<Slot, Slot>>;
  locked?: boolean;
}

export interface Scene {
  version: 1;
  format: FormatId;
  size: DetailSize;
  paletteId: string;
  substrate: 'confetti' | 'diagonal' | 'none';
  /** Single scene scale, anchored at the frame center. */
  scale: number;
  /** Order is z-order: first item is at the bottom. */
  items: Instance[];
}
