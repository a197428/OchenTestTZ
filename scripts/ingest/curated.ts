import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DetailSize, ObjectId, Slot } from '../../src/core/types';

export interface FigmaObjectEntry {
  id: ObjectId;
  nameRu: string;
  paths: Record<DetailSize, Record<'main' | 'bg', string[]>>;
  expectedPaths: Record<DetailSize, Record<'main' | 'bg', number>>;
  ignoredPaths?: Partial<Record<DetailSize, string[]>>;
  note?: string;
}

export interface FigmaMap {
  version: number;
  sheets: Record<DetailSize, { file: string; root: string }>;
  objects: FigmaObjectEntry[];
  substrates: {
    L: Record<string, string[]>;
    S: Record<string, string[]>;
  };
}

export interface PaletteScheme {
  id: string;
  nameRu: string;
  slots: Record<Slot, string>;
}

export interface PalettesFile {
  version: number;
  sourceScheme: string;
  schemes: PaletteScheme[];
}

export interface MetaEntry {
  id: ObjectId;
  nameRu: string;
  nameEn: string;
  synonyms: string[];
  tags: string[];
  heroWeight: number;
}

export interface MetaFile {
  version: number;
  objects: MetaEntry[];
}

export interface CuratedData {
  figmaMap: FigmaMap;
  palettes: PalettesFile;
  meta: MetaFile;
}

export function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

export function loadCurated(projectRoot: string): CuratedData {
  const curatedDir = path.join(projectRoot, 'data', 'curated');
  return {
    figmaMap: loadJson<FigmaMap>(path.join(curatedDir, 'figma-map.json')),
    palettes: loadJson<PalettesFile>(path.join(curatedDir, 'palettes.source.json')),
    meta: loadJson<MetaFile>(path.join(curatedDir, 'objects.meta.json')),
  };
}

export function getMeta(meta: MetaFile, id: ObjectId): MetaEntry {
  const entry = meta.objects.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`Missing semantic metadata for object "${id}"`);
  }
  return entry;
}

export function getSourceScheme(palettes: PalettesFile): PaletteScheme {
  const scheme = palettes.schemes.find((item) => item.id === palettes.sourceScheme);
  if (!scheme) {
    throw new Error(`Missing source palette "${palettes.sourceScheme}"`);
  }
  return scheme;
}
