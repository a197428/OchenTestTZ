import type { DetailSize, FormatId, ObjectId, ObjectState, Scene } from '../types';

export interface TemplateItemData {
  objectId: ObjectId;
  state: ObjectState;
  size: DetailSize;
  x: number;
  y: number;
  z: number;
}

export interface TemplateData {
  id: string;
  sceneId: string;
  format: FormatId;
  scheme: string;
  substrate: 'confetti' | 'diagonal';
  frameId?: string;
  items: TemplateItemData[];
}

export interface RelationData {
  from: ObjectId;
  fromState: ObjectState;
  to: ObjectId;
  toState: ObjectState;
  offsets: [number, number][];
  count: number;
}

export interface FormatStatsData {
  templates: number;
  itemsPerScene: { mean: number; median: number };
  cropShare: { mean: number; median: number; p90: number };
  density: { mean: number; median: number };
  emptyLeft: { mean: number; median: number };
  minDistance: { mean: number; median: number };
}

export interface StatsData {
  version: 1;
  byFormat: Record<FormatId, FormatStatsData>;
  colorPermutations?: unknown[];
}

export interface LayoutData {
  templates: TemplateData[];
  relations: RelationData[];
  stats: StatsData;
}

export interface LayoutItemRequest {
  objectId: ObjectId;
  state?: ObjectState;
}

export interface LayoutRequest {
  items: LayoutItemRequest[];
  format: FormatId;
  size: DetailSize;
  seed: number;
  headlineSpace?: 'none' | 'left' | 'top';
  backdrop?: 'auto' | 'on' | 'off';
  heroId?: ObjectId;
  paletteId?: string;
  substrate?: Scene['substrate'];
  scale?: number;
  candidates?: number;
}
