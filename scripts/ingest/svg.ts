import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import type { Document, Element, Node } from '@xmldom/xmldom';
import { svgPathBbox } from 'svg-path-bbox';
import { svgPathProperties } from 'svg-path-properties';
import type { Matrix } from '../../src/core/types';

export interface Point {
  x: number;
  y: number;
}

export interface PathSignature {
  hash: string;
  x0: number;
  y0: number;
  width: number;
  height: number;
  k: number;
  points: Point[];
}

export interface ShapeSignature {
  x0: number;
  y0: number;
  width: number;
  height: number;
  k: number;
  /** Arc-length samples normalized by the path bbox, as [x, y, x, y, ...]. */
  samples: number[];
}

export interface PathMatch {
  source: number;
  target: number;
}

export interface FitResult {
  scale: number;
  tx: number;
  ty: number;
  matched: number;
  total: number;
  rms: number;
  matches: PathMatch[];
}

const TOKEN_RE = /[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

export function fixId(value: string | null | undefined): string {
  if (!value) return '';
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  return decoded.includes('�') ? value : decoded;
}

export function parseSvg(filePath: string): Document {
  const source = readFileSync(filePath, 'utf8');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (!doc.documentElement) {
    throw new Error(`Failed to parse SVG: ${filePath}`);
  }
  return doc;
}

export function childElements(node: Node): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes.item(i);
    if (child && child.nodeType === 1) {
      result.push(child as Element);
    }
  }
  return result;
}

export function elementId(element: Element): string {
  return fixId(element.getAttribute('id'));
}

export function findSheetRoot(doc: Document): Element {
  const root = doc.documentElement;
  if (!root) {
    throw new Error('SVG document has no root element');
  }
  const groups = childElements(root).filter((child) => child.tagName === 'g');
  if (groups.length !== 1) {
    throw new Error(`Expected a single sheet root, found ${groups.length}`);
  }
  return groups[0]!;
}

export function resolveGroup(root: Element, names: readonly string[]): Element {
  let current = root;
  const walked: string[] = [];
  for (const name of names) {
    const next = childElements(current).find(
      (child) => child.tagName === 'g' && elementId(child) === name,
    );
    walked.push(name);
    if (!next) {
      throw new Error(`Group not found: ${walked.join(' > ')}`);
    }
    current = next;
  }
  return current;
}

export function collectPaths(group: Element, ignoredIds: ReadonlySet<string>): Element[] {
  const result: Element[] = [];

  const walk = (node: Element): void => {
    if (ignoredIds.has(elementId(node))) return;
    if (node.tagName === 'path') {
      result.push(node);
    }
    for (const child of childElements(node)) {
      walk(child);
    }
  };

  for (const child of childElements(group)) {
    walk(child);
  }
  return result;
}

export interface PathSampler {
  getTotalLength(): number;
  getPointAtLength(fractionLength: number): Point;
}

export function createPathSampler(d: string): PathSampler {
  const Constructor = svgPathProperties as unknown as new (source: string) => PathSampler;
  return new Constructor(d);
}

export function pathBBox(d: string): [number, number, number, number] {
  const bbox = svgPathBbox(d);
  if (!bbox.every(Number.isFinite)) {
    throw new Error(`Invalid path bbox for: ${d.slice(0, 60)}`);
  }
  return bbox;
}

export function pathPoints(d: string): Point[] {
  const tokens = d.match(TOKEN_RE) ?? [];
  const points: Point[] = [];
  let index = 0;
  let command = '';
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  const number = (): number => {
    const token = tokens[index++];
    if (token === undefined) {
      throw new Error(`Unexpected end of path: ${d.slice(0, 60)}`);
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid number "${token}" in path`);
    }
    return value;
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      index++;
    } else if (!command) {
      throw new Error('Path data must start with a command');
    }

    const upper = command.toUpperCase();
    const relative = command !== upper;

    switch (upper) {
      case 'M': {
        const x = number();
        const y = number();
        const nx = relative ? cx + x : x;
        const ny = relative ? cy + y : y;
        cx = nx;
        cy = ny;
        startX = nx;
        startY = ny;
        points.push({ x: nx, y: ny });
        command = relative ? 'l' : 'L';
        break;
      }
      case 'L': {
        const x = number();
        const y = number();
        cx = relative ? cx + x : x;
        cy = relative ? cy + y : y;
        points.push({ x: cx, y: cy });
        break;
      }
      case 'H': {
        const x = number();
        cx = relative ? cx + x : x;
        points.push({ x: cx, y: cy });
        break;
      }
      case 'V': {
        const y = number();
        cy = relative ? cy + y : y;
        points.push({ x: cx, y: cy });
        break;
      }
      case 'C': {
        const x1 = number();
        const y1 = number();
        const x2 = number();
        const y2 = number();
        const x = number();
        const y = number();
        const c1 = { x: relative ? cx + x1 : x1, y: relative ? cy + y1 : y1 };
        const c2 = { x: relative ? cx + x2 : x2, y: relative ? cy + y2 : y2 };
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        points.push(c1, c2, end);
        cx = end.x;
        cy = end.y;
        break;
      }
      case 'S': {
        const x2 = number();
        const y2 = number();
        const x = number();
        const y = number();
        const c2 = { x: relative ? cx + x2 : x2, y: relative ? cy + y2 : y2 };
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        points.push(c2, end);
        cx = end.x;
        cy = end.y;
        break;
      }
      case 'Q': {
        const x1 = number();
        const y1 = number();
        const x = number();
        const y = number();
        const c1 = { x: relative ? cx + x1 : x1, y: relative ? cy + y1 : y1 };
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        points.push(c1, end);
        cx = end.x;
        cy = end.y;
        break;
      }
      case 'T': {
        const x = number();
        const y = number();
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        points.push(end);
        cx = end.x;
        cy = end.y;
        break;
      }
      case 'A': {
        number();
        number();
        number();
        number();
        number();
        const x = number();
        const y = number();
        const end = { x: relative ? cx + x : x, y: relative ? cy + y : y };
        points.push(end);
        cx = end.x;
        cy = end.y;
        break;
      }
      case 'Z': {
        cx = startX;
        cy = startY;
        points.push({ x: cx, y: cy });
        break;
      }
      default:
        throw new Error(`Unsupported path command: ${command}`);
    }
  }

  return points;
}

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export function pathSignature(d: string): PathSignature | null {
  const bbox = pathBBox(d);
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const k = Math.max(width, height);
  if (!(k >= 3)) return null;

  const points = pathPoints(d);
  const normalized = points.map(
    (point) => [round2((point.x - bbox[0]) / k), round2((point.y - bbox[1]) / k)] as const,
  );
  const hash = createHash('sha1').update(JSON.stringify(normalized)).digest('hex');
  return { hash, x0: bbox[0], y0: bbox[1], width, height, k, points };
}

export function shapeSignature(d: string, sampleCount = 32, minK = 3): ShapeSignature | null {
  const bbox = pathBBox(d);
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const k = Math.max(width, height);
  if (!(k >= minK)) return null;

  let total: number;
  let sampler: PathSampler;
  try {
    sampler = createPathSampler(d);
    total = sampler.getTotalLength();
  } catch {
    return null;
  }
  if (!(total > 0)) return null;

  const samples: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const point = sampler.getPointAtLength((total * i) / (sampleCount - 1));
    samples.push((point.x - bbox[0]) / k, (point.y - bbox[1]) / k);
  }
  return { x0: bbox[0], y0: bbox[1], width, height, k, samples };
}

export function shapeDistance(a: ShapeSignature, b: ShapeSignature): number {
  if (a.samples.length !== b.samples.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.samples.length; i++) {
    const delta = a.samples[i]! - b.samples[i]!;
    sum += delta * delta;
  }
  return Math.sqrt(sum / (a.samples.length / 2));
}

export function matchShapes(
  source: readonly (ShapeSignature | null)[],
  target: readonly (ShapeSignature | null)[],
  tolerance = 0.02,
): PathMatch[] {
  const candidates: { source: number; target: number; distance: number }[] = [];
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex++) {
    const left = source[sourceIndex];
    if (!left) continue;
    for (let targetIndex = 0; targetIndex < target.length; targetIndex++) {
      const right = target[targetIndex];
      if (!right) continue;
      const distance = shapeDistance(left, right);
      if (distance <= tolerance) {
        candidates.push({ source: sourceIndex, target: targetIndex, distance });
      }
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const usedSource = new Set<number>();
  const usedTarget = new Set<number>();
  const matches: PathMatch[] = [];
  for (const candidate of candidates) {
    if (usedSource.has(candidate.source) || usedTarget.has(candidate.target)) continue;
    usedSource.add(candidate.source);
    usedTarget.add(candidate.target);
    matches.push({ source: candidate.source, target: candidate.target });
  }
  return matches;
}

export function matchSignatures(
  source: readonly (PathSignature | null)[],
  target: readonly (PathSignature | null)[],
): PathMatch[] {
  const byHash = new Map<string, number[]>();
  target.forEach((signature, index) => {
    if (!signature) return;
    const list = byHash.get(signature.hash);
    if (list) list.push(index);
    else byHash.set(signature.hash, [index]);
  });

  const matches: PathMatch[] = [];
  source.forEach((signature, sourceIndex) => {
    if (!signature) return;
    const list = byHash.get(signature.hash);
    if (!list || list.length === 0) return;
    const targetIndex = list.shift();
    if (targetIndex === undefined) return;
    matches.push({ source: sourceIndex, target: targetIndex });
  });
  return matches;
}

function solve3x3(matrix: number[][], vector: number[]): [number, number, number] {
  const a = matrix.map((row, index) => [...row, vector[index] ?? 0]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) {
      throw new Error('Singular least-squares system');
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const divisor = a[col]![col]!;
    for (let j = col; j < 4; j++) {
      a[col]![j] = a[col]![j]! / divisor;
    }
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      if (factor === 0) continue;
      for (let j = col; j < 4; j++) {
        a[row]![j] = a[row]![j]! - factor * a[col]![j]!;
      }
    }
  }
  return [a[0]![3]!, a[1]![3]!, a[2]![3]!];
}

export function fitSourceToTarget(
  sourcePaths: readonly string[],
  targetPaths: readonly string[],
): FitResult {
  const sourceSignatures = sourcePaths.map((d) => shapeSignature(d));
  const targetSignatures = targetPaths.map((d) => shapeSignature(d));
  const matches = matchShapes(sourceSignatures, targetSignatures);

  const points: { sx: number; sy: number; tx: number; ty: number }[] = [];
  for (const match of matches) {
    const source = sourceSignatures[match.source];
    const target = targetSignatures[match.target];
    if (!source || !target) continue;
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    const targetWidth = target.width;
    const targetHeight = target.height;
    const corners: [number, number, number, number][] = [
      [source.x0, source.y0, target.x0, target.y0],
      [source.x0 + sourceWidth, source.y0, target.x0 + targetWidth, target.y0],
      [source.x0, source.y0 + sourceHeight, target.x0, target.y0 + targetHeight],
      [
        source.x0 + sourceWidth,
        source.y0 + sourceHeight,
        target.x0 + targetWidth,
        target.y0 + targetHeight,
      ],
    ];
    for (const [sx, sy, tx, ty] of corners) {
      points.push({ sx, sy, tx, ty });
    }
  }

  if (matches.length < 5 || points.length === 0) {
    throw new Error(`Not enough matched paths: ${matches.length}`);
  }

  let sumSquares = 0;
  let sumX = 0;
  let sumY = 0;
  let sumTX = 0;
  let sumTY = 0;
  let sumXTX = 0;
  let sumYTY = 0;
  for (const point of points) {
    sumSquares += point.sx * point.sx + point.sy * point.sy;
    sumX += point.sx;
    sumY += point.sy;
    sumTX += point.tx;
    sumTY += point.ty;
    sumXTX += point.sx * point.tx;
    sumYTY += point.sy * point.ty;
  }
  const n = points.length;
  const [scale, tx, ty] = solve3x3(
    [
      [sumSquares, sumX, sumY],
      [sumX, n, 0],
      [sumY, 0, n],
    ],
    [sumXTX + sumYTY, sumTX, sumTY],
  );

  let squaredError = 0;
  for (const point of points) {
    const dx = scale * point.sx + tx - point.tx;
    const dy = scale * point.sy + ty - point.ty;
    squaredError += dx * dx + dy * dy;
  }
  const rms = Math.sqrt(squaredError / (2 * n));

  return { scale, tx, ty, matched: matches.length, total: sourcePaths.length, rms, matches };
}

export function applyMatrix(matrix: Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

export function transformBBox(
  bbox: [number, number, number, number],
  matrix: Matrix,
): [number, number, number, number] {
  const corners = [
    applyMatrix(matrix, bbox[0], bbox[1]),
    applyMatrix(matrix, bbox[2], bbox[1]),
    applyMatrix(matrix, bbox[0], bbox[3]),
    applyMatrix(matrix, bbox[2], bbox[3]),
  ];
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points]
    .map((point) => ({ x: point.x, y: point.y }))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

  const unique: Point[] = [];
  for (const point of sorted) {
    const last = unique[unique.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) {
      unique.push(point);
    }
  }
  if (unique.length <= 2) return unique;

  const lower: Point[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Point[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const point = unique[i]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function simplifyHull(hull: Point[], maxPoints: number): Point[] {
  if (hull.length <= maxPoints) return hull;

  const lengths: number[] = [];
  let perimeter = 0;
  for (let i = 0; i < hull.length; i++) {
    const current = hull[i]!;
    const next = hull[(i + 1) % hull.length]!;
    const length = Math.hypot(next.x - current.x, next.y - current.y);
    lengths.push(length);
    perimeter += length;
  }

  const result: Point[] = [];
  let segment = 0;
  let segmentEnd = lengths[0] ?? 0;
  for (let i = 0; i < maxPoints; i++) {
    const target = (perimeter * i) / maxPoints;
    while (segment < hull.length - 1 && target > segmentEnd) {
      segment++;
      segmentEnd += lengths[segment] ?? 0;
    }
    result.push(hull[segment]!);
  }
  return result;
}

export function buildHull(paths: readonly string[], matrix: Matrix, maxPoints = 64): Point[] {
  const points: Point[] = [];
  for (const d of paths) {
    let sampled = false;
    try {
      const properties = createPathSampler(d);
      const total = properties.getTotalLength();
      if (total > 0) {
        const samples = 24;
        for (let i = 0; i <= samples; i++) {
          const point = properties.getPointAtLength((total * i) / samples);
          const [tx, ty] = applyMatrix(matrix, point.x, point.y);
          points.push({ x: tx, y: ty });
        }
        sampled = true;
      }
    } catch {
      // Fall back to bbox corners below.
    }

    for (const point of pathPoints(d)) {
      const [tx, ty] = applyMatrix(matrix, point.x, point.y);
      points.push({ x: tx, y: ty });
    }

    if (!sampled) {
      const bbox = pathBBox(d);
      for (const [x, y] of [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[1]],
        [bbox[0], bbox[3]],
        [bbox[2], bbox[3]],
      ] as const) {
        const [tx, ty] = applyMatrix(matrix, x, y);
        points.push({ x: tx, y: ty });
      }
    }
  }
  return simplifyHull(convexHull(points), maxPoints);
}

export function bboxSize(bbox: [number, number, number, number]): { w: number; h: number } {
  return { w: bbox[2] - bbox[0], h: bbox[3] - bbox[1] };
}

export function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
