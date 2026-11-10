import type { FragmentPath, Palette, Slot } from './types';

export function slotColor(palette: Palette, slot: Slot): string {
  const hex = palette.slots[slot];
  if (!hex) {
    throw new Error(`Palette ${palette.id} is missing slot ${slot}`);
  }
  return hex.toUpperCase();
}

export interface RecoloredFragment {
  fill?: string;
  stroke?: string;
}

export function recolorFragment(fragment: FragmentPath, palette: Palette): RecoloredFragment {
  return {
    ...(fragment.fill ? { fill: slotColor(palette, fragment.fill) } : {}),
    ...(fragment.stroke ? { stroke: slotColor(palette, fragment.stroke) } : {}),
  };
}
