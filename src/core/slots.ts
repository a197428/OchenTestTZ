import type { Slot } from './types';

export const SLOTS: readonly Slot[] = [
  'bg-light',
  'bg-mid',
  'bg-dark',
  'obj-1',
  'obj-2',
  'obj-3',
  'ink',
  'white',
];

export const BG_SLOTS: readonly Slot[] = ['bg-light', 'bg-mid', 'bg-dark'];

export const OBJ_SLOTS: readonly Slot[] = ['obj-1', 'obj-2', 'obj-3'];

export const INK_SLOTS: readonly Slot[] = ['ink', 'white'];

export function isBgSlot(slot: Slot): boolean {
  return BG_SLOTS.includes(slot);
}

export function isObjSlot(slot: Slot): boolean {
  return OBJ_SLOTS.includes(slot);
}
