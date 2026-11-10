import { differenceCiede2000, formatHex, oklch, parse, wcagContrast } from 'culori';
import { BG_SLOTS, OBJ_SLOTS, SLOTS } from './slots';
import type { Palette, Slot } from './types';

export const INK_COLOR = '#181817';
export const WHITE_COLOR = '#FFFFFF';

export const BUILTIN_PALETTES: readonly Palette[] = [
  {
    id: 'purple',
    name: 'purple',
    builtin: true,
    slots: {
      'bg-light': '#D7CDF5',
      'bg-mid': '#AA9BF0',
      'bg-dark': '#7864D7',
      'obj-1': '#F9ECB0',
      'obj-2': '#F9A3AA',
      'obj-3': '#FFE3E1',
      ink: INK_COLOR,
      white: WHITE_COLOR,
    },
  },
  {
    id: 'orange',
    name: 'orange',
    builtin: true,
    slots: {
      'bg-light': '#FDD7B9',
      'bg-mid': '#FAC896',
      'bg-dark': '#D27532',
      'obj-1': '#F9ECB0',
      'obj-2': '#80DADA',
      'obj-3': '#BEEBEB',
      ink: INK_COLOR,
      white: WHITE_COLOR,
    },
  },
  {
    id: 'teal',
    name: 'teal',
    builtin: true,
    slots: {
      'bg-light': '#BEEBEB',
      'bg-mid': '#80DADA',
      'bg-dark': '#5ABEBE',
      'obj-1': '#FFD4F2',
      'obj-2': '#6D7BFC',
      'obj-3': '#B6C6FE',
      ink: INK_COLOR,
      white: WHITE_COLOR,
    },
  },
];

export interface PaletteParseResult {
  palette: Palette;
  warnings: string[];
}

export function normalizeHex(value: string): string {
  const color = parse(value.trim());
  if (!color) {
    throw new Error(`Unrecognized color: ${value}`);
  }
  const hex = formatHex(color);
  return hex.slice(0, 7).toUpperCase();
}

export function paletteById(palettes: readonly Palette[], id: string): Palette {
  const found = palettes.find((palette) => palette.id === id);
  if (!found) {
    throw new Error(`Unknown palette: ${id}`);
  }
  return found;
}

export function parsePalette(
  input: string,
  options: { id?: string; name?: string } = {},
): PaletteParseResult {
  const text = input.trim();
  if (!text) {
    throw new Error('Palette input is empty');
  }

  const id = options.id ?? 'custom';
  const name = options.name ?? 'custom';

  const json = tryJson(text);
  if (json) {
    if (Array.isArray(json)) {
      return finalize(json.map(String), id, name);
    }
    if (typeof json === 'object') {
      const record = json as Record<string, unknown>;
      const full = parseFullSlots(record, id, name);
      if (full) return full;
      const split = parseSplitSlots(record, id, name);
      if (split) return split;
    }
  }

  const variables = parseCssVariables(text);
  if (variables) {
    return finalizeWithDefaults(variables, id, name);
  }

  const colors = extractHexColors(text);
  return finalize(colors, id, name);
}

function tryJson(text: string): unknown {
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseFullSlots(
  record: Record<string, unknown>,
  id: string,
  name: string,
): PaletteParseResult | null {
  const slots = record.slots;
  if (!slots || typeof slots !== 'object') return null;
  const source = slots as Record<string, unknown>;
  const values: Partial<Record<Slot, string>> = {};
  for (const slot of SLOTS) {
    const value = source[slot];
    if (typeof value !== 'string') return null;
    values[slot] = value;
  }
  return buildPalette(values as Record<Slot, string>, id, name, {
    paletteId: typeof record.id === 'string' ? record.id : id,
    paletteName: typeof record.name === 'string' ? record.name : name,
  });
}

function parseSplitSlots(
  record: Record<string, unknown>,
  id: string,
  name: string,
): PaletteParseResult | null {
  const bg = record.bg;
  const obj = record.obj;
  if (!Array.isArray(bg) || !Array.isArray(obj) || bg.length < 3 || obj.length < 3) {
    return null;
  }
  const colors = [...bg.slice(0, 3), ...obj.slice(0, 3)].map(String);
  const ink = typeof record.ink === 'string' ? record.ink : INK_COLOR;
  const white = typeof record.white === 'string' ? record.white : WHITE_COLOR;
  return finalize(colors, id, name, ink, white);
}

function parseCssVariables(text: string): Partial<Record<Slot, string>> | null {
  const result: Partial<Record<Slot, string>> = {};
  const pattern = /(--[\w-]+)\s*:\s*([^;}\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1] ?? '';
    const value = match[2] ?? '';
    for (const slot of SLOTS) {
      if (name === `--${slot}` || name.endsWith(`-${slot}`)) {
        result[slot] = value.trim();
      }
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function extractHexColors(text: string): string[] {
  return text.match(/#(?:[0-9a-fA-F]{3,8})\b/g) ?? [];
}

function finalizeWithDefaults(
  partial: Partial<Record<Slot, string>>,
  id: string,
  name: string,
): PaletteParseResult {
  if (SLOTS.every((slot) => partial[slot] !== undefined)) {
    return buildPalette(partial as Record<Slot, string>, id, name, {});
  }
  if (
    BG_SLOTS.every((slot) => partial[slot] !== undefined) &&
    OBJ_SLOTS.every((slot) => partial[slot] !== undefined)
  ) {
    return finalize(
      [...BG_SLOTS, ...OBJ_SLOTS].map((slot) => partial[slot]!),
      id,
      name,
      partial.ink ?? INK_COLOR,
      partial.white ?? WHITE_COLOR,
    );
  }
  throw new Error('CSS variables must define all eight slots or six bg/obj slots');
}

function finalize(
  rawColors: readonly string[],
  id: string,
  name: string,
  ink = INK_COLOR,
  white = WHITE_COLOR,
): PaletteParseResult {
  const colors = rawColors.map((value) => normalizeHex(value));
  if (colors.length === 8) {
    const slots = Object.fromEntries(SLOTS.map((slot, index) => [slot, colors[index]!])) as Record<
      Slot,
      string
    >;
    return buildPalette(slots, id, name, {});
  }
  if (colors.length !== 6) {
    throw new Error(`Expected 6 or 8 colors, got ${colors.length}`);
  }

  const cluster = closestHueCluster(colors);
  const remaining = colors.filter((_, index) => !cluster.has(index));
  const ordered = [...cluster]
    .map((index) => ({ index, lightness: lightnessOf(colors[index]!) }))
    .sort((a, b) => a.lightness - b.lightness)
    .map((item) => colors[item.index]!);

  const slots: Record<Slot, string> = {
    'bg-dark': ordered[0]!,
    'bg-mid': ordered[1]!,
    'bg-light': ordered[2]!,
    'obj-1': remaining[0]!,
    'obj-2': remaining[1]!,
    'obj-3': remaining[2]!,
    ink: normalizeHex(ink),
    white: normalizeHex(white),
  };
  return buildPalette(slots, id, name, {});
}

function buildPalette(
  rawSlots: Record<Slot, string>,
  id: string,
  name: string,
  overrides: { paletteId?: string; paletteName?: string },
): PaletteParseResult {
  const slots = Object.fromEntries(
    SLOTS.map((slot) => [slot, normalizeHex(rawSlots[slot])]),
  ) as Record<Slot, string>;
  const palette: Palette = {
    id: overrides.paletteId ?? id,
    name: overrides.paletteName ?? name,
    slots,
  };
  return { palette, warnings: validatePalette(palette) };
}

function closestHueCluster(colors: readonly string[]): Set<number> {
  const hues = colors.map((color) => hueOf(color));
  let best: { indexes: number[]; span: number; chroma: number } | null = null;
  for (let i = 0; i < colors.length - 2; i++) {
    for (let j = i + 1; j < colors.length - 1; j++) {
      for (let k = j + 1; k < colors.length; k++) {
        const indexes = [i, j, k];
        const span = hueSpan(indexes.map((index) => hues[index]!));
        const chroma =
          indexes.reduce((sum, index) => sum + chromaOf(colors[index]!), 0) / indexes.length;
        if (!best || span < best.span || (span === best.span && chroma > best.chroma)) {
          best = { indexes, span, chroma };
        }
      }
    }
  }
  return new Set(best?.indexes ?? [0, 1, 2]);
}

function hueSpan(hues: readonly number[]): number {
  const sorted = [...hues].sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    const next = sorted[(i + 1) % sorted.length]! + (i === sorted.length - 1 ? 360 : 0);
    maxGap = Math.max(maxGap, next - current);
  }
  return 360 - maxGap;
}

function oklchOf(color: string): { l: number; c: number; h: number } {
  const parsed = parse(color);
  if (!parsed) throw new Error(`Unrecognized color: ${color}`);
  const value = oklch(parsed);
  if (!value) throw new Error(`Cannot convert color to OKLCH: ${color}`);
  return {
    l: value.l,
    c: value.c ?? 0,
    h: Number.isFinite(value.h) ? (value.h as number) : 0,
  };
}

function hueOf(color: string): number {
  return oklchOf(color).h;
}

function chromaOf(color: string): number {
  return oklchOf(color).c;
}

function lightnessOf(color: string): number {
  return oklchOf(color).l;
}

function colorValue(color: string) {
  const parsed = parse(color);
  if (!parsed) throw new Error(`Unrecognized color: ${color}`);
  return parsed;
}

export function validatePalette(palette: Palette): string[] {
  const warnings: string[] = [];
  const difference = differenceCiede2000();

  for (const objSlot of OBJ_SLOTS) {
    for (const bgSlot of BG_SLOTS) {
      const delta = difference(
        colorValue(palette.slots[objSlot]),
        colorValue(palette.slots[bgSlot]),
      );
      if (delta < 5) {
        warnings.push(`${objSlot} is too close to ${bgSlot} (dE ${delta.toFixed(1)})`);
      }
    }
  }

  const light = lightnessOf(palette.slots['bg-light']);
  const mid = lightnessOf(palette.slots['bg-mid']);
  const dark = lightnessOf(palette.slots['bg-dark']);
  if (!(light > mid && mid > dark)) {
    warnings.push('Background lightness is not ordered bg-light > bg-mid > bg-dark');
  }

  const contrast = wcagContrast(
    colorValue(palette.slots.ink),
    colorValue(palette.slots['bg-light']),
  );
  if (contrast < 3) {
    warnings.push(`Ink/bg-light contrast is low (${contrast.toFixed(1)}:1)`);
  }

  return warnings;
}
