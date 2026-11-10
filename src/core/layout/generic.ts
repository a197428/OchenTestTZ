import {
  objectById,
  variantFor,
  type Catalog,
  type CatalogObject,
  type CatalogVariant,
} from '../catalog';
import type { ObjectId, ObjectState, Scene } from '../types';
import { FORMATS } from './formats';
import { mulberry32, pick, randomBetween } from './random';
import {
  pairKey,
  scoreCandidate,
  type Placement,
  type PlacementRole,
  type ScoreContext,
} from './score';
import type { LayoutData, LayoutRequest, RelationData } from './types';

interface ItemSpec {
  objectId: ObjectId;
  state: ObjectState;
  object: CatalogObject;
  variant: CatalogVariant;
  role: PlacementRole;
}

export function generateLayout(request: LayoutRequest, catalog: Catalog, data: LayoutData): Scene {
  const frame = FORMATS[request.format];
  const paletteId = request.paletteId ?? 'purple';
  const substrate = request.substrate ?? 'none';
  const size = request.size;

  if (request.items.length === 0) {
    return {
      version: 1,
      format: request.format,
      size,
      paletteId,
      substrate,
      scale: 1,
      items: [],
    };
  }

  const random = mulberry32(request.seed >>> 0);
  const specs = request.items.map((item): ItemSpec => {
    const object = objectById(catalog, item.objectId);
    const state = item.state ?? 'main';
    return {
      objectId: item.objectId,
      state,
      object,
      variant: variantFor(object, state, size),
      role: 'support',
    };
  });

  const explicitMain = specs.filter((spec) => spec.state === 'main');
  const explicitBackdrop = specs.filter((spec) => spec.state === 'bg');

  let heroSpec: ItemSpec | null;
  if (request.heroId) {
    heroSpec =
      explicitMain.find((spec) => spec.objectId === request.heroId) ?? explicitMain[0] ?? null;
  } else {
    heroSpec = explicitMain.reduce<ItemSpec | null>((best, spec) => {
      if (!best) return spec;
      return spec.object.meta.heroWeight > best.object.meta.heroWeight ? spec : best;
    }, null);
  }
  if (heroSpec) heroSpec.role = 'hero';

  const backdropMode = request.backdrop ?? 'auto';
  const backdropSpecs = [...explicitBackdrop];
  const shouldAddBackdrop =
    backdropSpecs.length === 0 &&
    explicitMain.length > 0 &&
    (backdropMode === 'on' || (backdropMode === 'auto' && random() < 0.5));
  if (shouldAddBackdrop) {
    const source = heroSpec ?? explicitMain[0];
    if (source) {
      const backdropObject = source.object;
      const backdropVariant = variantFor(backdropObject, 'bg', size);
      backdropSpecs.push({
        objectId: backdropObject.id,
        state: 'bg',
        object: backdropObject,
        variant: backdropVariant,
        role: 'backdrop',
      });
    }
  }
  for (const spec of backdropSpecs) spec.role = 'backdrop';

  const mainSpecs = specs.filter((spec) => spec.role !== 'backdrop');
  const hero = heroSpec;
  const relatedPairs = new Set<string>();
  for (const relation of data.relations) {
    relatedPairs.add(pairKey(relation.from, relation.to));
  }

  const cluster = {
    x: request.headlineSpace === 'left' ? frame.width * 0.62 : frame.width / 2,
    y: request.headlineSpace === 'top' ? frame.height * 0.62 : frame.height / 2,
  };

  const candidateCount = request.candidates ?? 300;
  let best: { placements: Placement[]; scale: number; score: number } | null = null;

  for (let attempt = 0; attempt < candidateCount; attempt++) {
    const placements = generateCandidate(
      mainSpecs,
      hero,
      backdropSpecs,
      cluster,
      frame.width,
      frame.height,
      data.relations,
      random,
    );
    let sceneScale =
      request.scale ??
      autoScale(placements, frame.width, frame.height, {
        left: request.headlineSpace === 'left',
        top: request.headlineSpace === 'top',
      });
    if (request.headlineSpace === 'left' || request.headlineSpace === 'top') {
      shiftForHeadline(placements, request.headlineSpace, sceneScale, frame.width, frame.height);
    }
    if (request.scale !== undefined) sceneScale = request.scale;

    const context: ScoreContext = {
      frameWidth: frame.width,
      frameHeight: frame.height,
      sceneScale,
      headlineSpace: request.headlineSpace ?? 'none',
      relatedPairs,
      stats: data.stats.byFormat[request.format],
    };
    const score = scoreCandidate(placements, context);
    if (!best || score < best.score) {
      best = { placements, scale: sceneScale, score };
    }
  }

  const placements = best?.placements ?? [];
  const ordered = orderPlacements(placements, data.relations);
  return {
    version: 1,
    format: request.format,
    size,
    paletteId,
    substrate,
    scale: best?.scale ?? 1,
    items: ordered.map((placement, index) => ({
      id: `gen-${request.seed}-${index}-${placement.objectId}`,
      objectId: placement.objectId,
      state: placement.state,
      x: placement.x,
      y: placement.y,
      rotation: 0,
    })),
  };
}

function generateCandidate(
  mainSpecs: readonly ItemSpec[],
  hero: ItemSpec | null,
  backdrops: readonly ItemSpec[],
  cluster: { x: number; y: number },
  frameWidth: number,
  frameHeight: number,
  relations: readonly RelationData[],
  random: () => number,
): Placement[] {
  const placements: Placement[] = [];
  const placedByObject = new Map<ObjectId, Placement>();

  const place = (spec: ItemSpec, x: number, y: number, role: PlacementRole): Placement => {
    const placement: Placement = {
      objectId: spec.objectId,
      state: spec.state,
      role,
      x,
      y,
      hull: spec.variant.hull,
      bbox: spec.variant.bbox,
    };
    placements.push(placement);
    if (role !== 'backdrop') placedByObject.set(spec.objectId, placement);
    return placement;
  };

  const centerX = (variant: CatalogVariant): number =>
    cluster.x - variant.bbox.w / 2 + randomBetween(random, -0.06, 0.06) * frameWidth;
  const centerY = (variant: CatalogVariant): number =>
    cluster.y - variant.bbox.h / 2 + randomBetween(random, -0.06, 0.06) * frameHeight;

  if (hero) {
    place(hero, centerX(hero.variant), centerY(hero.variant), 'hero');
  }

  for (const spec of mainSpecs) {
    if (spec === hero) continue;
    const relationPlacement = placementFromRelation(spec, placedByObject, relations, random);
    if (relationPlacement) {
      const jitter = 8;
      place(
        spec,
        relationPlacement.x + randomBetween(random, -jitter, jitter),
        relationPlacement.y + randomBetween(random, -jitter, jitter),
        'support',
      );
      continue;
    }

    const angle = pick(random, [-Math.PI / 6, Math.PI / 6, (5 * Math.PI) / 6, (-5 * Math.PI) / 6]);
    const reference = hero ?? mainSpecs[0]!;
    const distance =
      ((Math.max(reference.variant.bbox.w, reference.variant.bbox.h) +
        Math.max(spec.variant.bbox.w, spec.variant.bbox.h)) /
        2) *
      randomBetween(random, 0.55, 1.05);
    place(
      spec,
      cluster.x + Math.cos(angle) * distance - spec.variant.bbox.w / 2,
      cluster.y + Math.sin(angle) * distance - spec.variant.bbox.h / 2,
      'support',
    );
  }

  for (const spec of backdrops) {
    const edge = pick(random, ['left', 'right', 'top', 'bottom'] as const);
    let x = cluster.x - spec.variant.bbox.w / 2 + randomBetween(random, -0.2, 0.2) * frameWidth;
    let y = cluster.y - spec.variant.bbox.h / 2 + randomBetween(random, -0.2, 0.2) * frameHeight;
    if (edge === 'left') x -= frameWidth * 0.18;
    if (edge === 'right') x += frameWidth * 0.18;
    if (edge === 'top') y -= frameHeight * 0.16;
    if (edge === 'bottom') y += frameHeight * 0.16;
    place(spec, x, y, 'backdrop');
  }

  return placements;
}

function placementFromRelation(
  spec: ItemSpec,
  placed: Map<ObjectId, Placement>,
  relations: readonly RelationData[],
  random: () => number,
): { x: number; y: number } | null {
  const matches: { offset: [number, number]; target: Placement; direction: 'above' | 'below' }[] =
    [];
  for (const relation of relations) {
    if (relation.from === spec.objectId) {
      const target = placed.get(relation.to);
      if (target && relation.offsets.length > 0) {
        matches.push({ offset: pick(random, relation.offsets), target, direction: 'above' });
      }
    }
    if (relation.to === spec.objectId) {
      const target = placed.get(relation.from);
      if (target && relation.offsets.length > 0) {
        matches.push({ offset: pick(random, relation.offsets), target, direction: 'below' });
      }
    }
  }
  if (matches.length === 0) return null;
  const match = pick(random, matches);
  if (match.direction === 'above') {
    return { x: match.target.x + match.offset[0], y: match.target.y + match.offset[1] };
  }
  return { x: match.target.x - match.offset[0], y: match.target.y - match.offset[1] };
}

function autoScale(
  placements: readonly Placement[],
  frameWidth: number,
  frameHeight: number,
  headline: { left: boolean; top: boolean },
): number {
  const main = placements.filter((placement) => placement.role !== 'backdrop');
  if (main.length === 0) return 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const placement of main) {
    minX = Math.min(minX, placement.x);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, placement.x + placement.bbox.w);
    maxY = Math.max(maxY, placement.y + placement.bbox.h);
  }
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const safeWidth = frameWidth * (headline.left ? 0.62 : 0.9);
  const safeHeight = frameHeight * (headline.top ? 0.62 : 0.9);
  return Math.min(1.4, Math.max(0.35, Math.min(safeWidth / width, safeHeight / height)));
}

function shiftForHeadline(
  placements: Placement[],
  headlineSpace: 'left' | 'top',
  sceneScale: number,
  frameWidth: number,
  frameHeight: number,
): void {
  const main = placements.filter((placement) => placement.role !== 'backdrop');
  if (main.length === 0) return;
  if (headlineSpace === 'left') {
    const minX = Math.min(
      ...main.map((placement) =>
        scaledCoordinate(placement.x, frameWidth / 2, frameWidth / 2, sceneScale),
      ),
    );
    const limit = frameWidth * 0.32;
    if (minX < limit) {
      const delta = (limit - minX) / sceneScale;
      for (const placement of placements) placement.x += delta;
    }
  } else {
    const minY = Math.min(
      ...main.map((placement) =>
        scaledCoordinate(placement.y, frameHeight / 2, frameHeight / 2, sceneScale),
      ),
    );
    const limit = frameHeight * 0.28;
    if (minY < limit) {
      const delta = (limit - minY) / sceneScale;
      for (const placement of placements) placement.y += delta;
    }
  }
}

function scaledCoordinate(value: number, anchor: number, origin: number, factor: number): number {
  return origin + (value - anchor) * factor + anchor - origin;
}

function orderPlacements(
  placements: readonly Placement[],
  relations: readonly RelationData[],
): Placement[] {
  const backdrops = placements.filter((placement) => placement.role === 'backdrop');
  const main = placements.filter((placement) => placement.role !== 'backdrop');
  const defaultOrder = [...main].sort((a, b) => {
    if (a.role === b.role) return 0;
    if (a.role === 'hero') return 1;
    if (b.role === 'hero') return -1;
    return 0;
  });

  const indexOf = new Map<ObjectId, number>();
  defaultOrder.forEach((placement, index) => indexOf.set(placement.objectId, index));

  const edges = new Map<number, Set<number>>();
  for (let index = 0; index < defaultOrder.length; index++) edges.set(index, new Set());
  for (const placement of defaultOrder) {
    for (const relation of relations) {
      if (relation.from !== placement.objectId) continue;
      const upperIndex = indexOf.get(relation.from);
      const lowerIndex = indexOf.get(relation.to);
      if (upperIndex === undefined || lowerIndex === undefined) continue;
      if (upperIndex === lowerIndex) continue;
      edges.get(lowerIndex)?.add(upperIndex);
    }
  }

  const indegree = new Array(defaultOrder.length).fill(0) as number[];
  for (const targets of edges.values()) {
    for (const target of targets) indegree[target] += 1;
  }
  const queue: number[] = [];
  for (let index = 0; index < defaultOrder.length; index++) {
    if (indegree[index] === 0) queue.push(index);
  }
  const ordered: Placement[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => a - b);
    const index = queue.shift()!;
    ordered.push(defaultOrder[index]!);
    for (const target of edges.get(index) ?? []) {
      indegree[target] -= 1;
      if (indegree[target] === 0) queue.push(target);
    }
  }
  if (ordered.length !== defaultOrder.length) return [...backdrops, ...defaultOrder];
  return [...backdrops, ...ordered];
}
