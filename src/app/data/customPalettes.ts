import type { Catalog } from '../../core/catalog';
import { SLOTS } from '../../core/slots';
import type { Palette } from '../../core/types';

const STORAGE_KEY = 'illustration-composer.palettes.v1';

export function loadCustomPalettes(): Palette[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPalette);
  } catch {
    return [];
  }
}

export function registerCustomPalette(catalog: Catalog, palette: Palette): void {
  if (!catalog.palettes.some((item) => item.id === palette.id)) {
    catalog.palettes.push(palette);
  }
  try {
    const custom = catalog.palettes.filter((item) => !item.builtin);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
  } catch {
    // Persistence is optional; the palette still works for this session.
  }
}

function isPalette(value: unknown): value is Palette {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return false;
  if (typeof record.slots !== 'object' || record.slots === null) return false;
  const slots = record.slots as Record<string, unknown>;
  return SLOTS.every(
    (slot) => typeof slots[slot] === 'string' && /^#[0-9A-Fa-f]{6}$/.test(slots[slot]),
  );
}
