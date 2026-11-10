import {
  aroundPoint,
  bboxOfPoints,
  multiply,
  polygonsOverlap,
  scale as scaleMatrix,
  transformPoints,
  translate,
} from '../geometry';
import type { ObjectId } from '../types';
import type { FormatStatsData } from './types';

export type PlacementRole = 'hero' | 'support' | 'backdrop';

export interface Placement {
  objectId: ObjectId;
  state: 'main' | 'bg';
  role: PlacementRole;
  x: number;
  y: number;
  hull: [number, number][];
  bbox: { w: number; h: number };
}

export interface ScoreContext {
  frameWidth: number;
  frameHeight: number;
  sceneScale: number;
  headlineSpace: 'none' | 'left' | 'top';
  relatedPairs: Set<string>;
  stats: FormatStatsData;
}

export function pairKey(a: ObjectId, b: ObjectId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function placementHull(placement: Placement, context: ScoreContext): [number, number][] {
  const anchor = aroundPoint(
    context.frameWidth / 2,
    context.frameHeight / 2,
    scaleMatrix(context.sceneScale),
  );
  const matrix = multiply(anchor, translate(placement.x, placement.y));
  return transformPoints(matrix, placement.hull);
}

export function scoreCandidate(placements: readonly Placement[], context: ScoreContext): number {
  const main = placements.filter((placement) => placement.role !== 'backdrop');
  if (main.length === 0) return 10_000;

  const world = new Map<Placement, [number, number][]>();
  for (const placement of placements) {
    world.set(placement, placementHull(placement, context));
  }

  let score = 0;

  for (let i = 0; i < main.length; i++) {
    const a = main[i]!;
    const hullA = world.get(a)!;
    for (let j = i + 1; j < main.length; j++) {
      const b = main[j]!;
      if (!polygonsOverlap(hullA, world.get(b)!)) continue;
      if (context.relatedPairs.has(pairKey(a.objectId, b.objectId))) {
        score -= 30;
      } else {
        score += 900;
      }
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const placement of main) {
    const box = bboxOfPoints(world.get(placement)!);
    minX = Math.min(minX, box[0]);
    minY = Math.min(minY, box[1]);
    maxX = Math.max(maxX, box[2]);
    maxY = Math.max(maxY, box[3]);
    const crop = cropShare(box, context.frameWidth, context.frameHeight);
    const threshold = placement.role === 'hero' ? 0.05 : 0.3;
    if (crop > threshold) {
      score += (crop - threshold) * (placement.role === 'hero' ? 900 : 420);
    }

    if (context.headlineSpace === 'left' && box[0] < context.frameWidth * 0.32) {
      score += 600 + (context.frameWidth * 0.32 - box[0]);
    }
    if (context.headlineSpace === 'top' && box[1] < context.frameHeight * 0.28) {
      score += 600 + (context.frameHeight * 0.28 - box[1]);
    }
  }

  for (const placement of placements) {
    if (placement.role !== 'backdrop') continue;
    const box = bboxOfPoints(world.get(placement)!);
    if (cropShare(box, context.frameWidth, context.frameHeight) > 0.95) {
      score += 400;
    }
  }

  const unionWidth = Math.max(1, maxX - minX);
  const unionHeight = Math.max(1, maxY - minY);
  const fill = (unionWidth * unionHeight) / (context.frameWidth * context.frameHeight);
  const target = Math.min(0.75, Math.max(0.35, context.stats.density.mean));
  score += Math.abs(fill - target) * 120;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const shiftX =
    context.headlineSpace === 'left' ? context.frameWidth * 0.62 : context.frameWidth / 2;
  const shiftY =
    context.headlineSpace === 'top' ? context.frameHeight * 0.62 : context.frameHeight / 2;
  score +=
    (Math.abs(centerX - shiftX) / context.frameWidth +
      Math.abs(centerY - shiftY) / context.frameHeight) *
    180;

  return score;
}

function cropShare(box: [number, number, number, number], width: number, height: number): number {
  const area = Math.max(1, (box[2] - box[0]) * (box[3] - box[1]));
  const intersectionWidth = Math.max(0, Math.min(box[2], width) - Math.max(box[0], 0));
  const intersectionHeight = Math.max(0, Math.min(box[3], height) - Math.max(box[1], 0));
  return 1 - (intersectionWidth * intersectionHeight) / area;
}
