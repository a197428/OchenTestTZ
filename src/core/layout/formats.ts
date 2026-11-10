import type { FormatId } from '../types';

export interface FormatDef {
  id: FormatId;
  width: number;
  height: number;
}

export const FORMATS: Readonly<Record<FormatId, FormatDef>> = {
  square: { id: 'square', width: 1000, height: 1000 },
  wide: { id: 'wide', width: 1200, height: 630 },
  tall: { id: 'tall', width: 800, height: 1200 },
};

export const FORMAT_IDS: readonly FormatId[] = ['square', 'wide', 'tall'];
