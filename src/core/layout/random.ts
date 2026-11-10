export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBetween(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

export function pick<T>(random: () => number, values: readonly T[]): T {
  if (values.length === 0) {
    throw new Error('Cannot pick from an empty list');
  }
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))]!;
}
