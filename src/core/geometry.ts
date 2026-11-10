import { FORMATS } from './layout/formats';
import type { FormatId, Instance, Matrix, Scene } from './types';

export interface VariantGeometry {
  toNative: Matrix;
  bbox: { w: number; h: number };
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

export function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function scale(factor: number): Matrix {
  return [factor, 0, 0, factor, 0, 0];
}

export function rotate(degrees: number): Matrix {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

export function aroundPoint(x: number, y: number, matrix: Matrix): Matrix {
  return multiply(translate(x, y), multiply(matrix, translate(-x, -y)));
}

export function applyMatrix(matrix: Matrix, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

export function matrixToSvg(matrix: Matrix): string {
  return `matrix(${matrix.map((value) => round(value, 6)).join(' ')})`;
}

export function instanceMatrix(
  scene: Scene,
  item: Instance,
  variant: VariantGeometry,
  format: FormatId,
): Matrix {
  const frame = FORMATS[format];
  const anchor = aroundPoint(frame.width / 2, frame.height / 2, scale(scene.scale));
  const rotation = aroundPoint(variant.bbox.w / 2, variant.bbox.h / 2, rotate(item.rotation));
  return multiply(
    anchor,
    multiply(translate(item.x, item.y), multiply(rotation, variant.toNative)),
  );
}

export function transformPoints(
  matrix: Matrix,
  points: readonly [number, number][],
): [number, number][] {
  return points.map(([x, y]) => applyMatrix(matrix, x, y));
}

export function bboxOfPoints(
  points: readonly [number, number][],
): [number, number, number, number] {
  if (points.length === 0) return [0, 0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

export function pointInPolygon(
  x: number,
  y: number,
  polygon: readonly [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function polygonsOverlap(
  a: readonly [number, number][],
  b: readonly [number, number][],
): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const [x1, y1] = polygon[i]!;
      const [x2, y2] = polygon[(i + 1) % polygon.length]!;
      const axisX = -(y2 - y1);
      const axisY = x2 - x1;
      const [minA, maxA] = project(a, axisX, axisY);
      const [minB, maxB] = project(b, axisX, axisY);
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

export function hullsDistance(
  a: readonly [number, number][],
  b: readonly [number, number][],
): number {
  let best = Infinity;
  for (const [ax, ay] of a) {
    for (const [bx, by] of b) {
      best = Math.min(best, Math.hypot(ax - bx, ay - by));
    }
  }
  return Number.isFinite(best) ? best : 0;
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function project(
  polygon: readonly [number, number][],
  axisX: number,
  axisY: number,
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of polygon) {
    const value = x * axisX + y * axisY;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return [min, max];
}
