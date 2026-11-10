import Fuse from 'fuse.js';
import type { Catalog, CatalogObject } from '../catalog';

export interface SearchHit {
  object: CatalogObject;
  score: number;
  term: string;
}

export interface QueryResolution {
  matched: SearchHit[];
  unknown: string[];
  suggestions: SearchHit[];
}

interface IndexEntry {
  object: CatalogObject;
  keywords: string[];
}

const ENDINGS = [
  'иями',
  'ями',
  'ами',
  'ыми',
  'ими',
  'ого',
  'его',
  'ому',
  'ему',
  'ых',
  'их',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ой',
  'ей',
  'ый',
  'ий',
  'ов',
  'ев',
  'ам',
  'ям',
  'ах',
  'ях',
  'ом',
  'ем',
  'ую',
  'юю',
  'ия',
  'ии',
  'у',
  'ю',
  'а',
  'я',
  'ы',
  'и',
  'е',
  'о',
  'ь',
];

const indexCache = new WeakMap<Catalog, IndexEntry[]>();
const fuseCache = new WeakMap<Catalog, Fuse<IndexEntry>>();

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

export function stem(word: string): string {
  const normalized = normalizeText(word);
  if (normalized.length <= 4) return normalized;
  for (const ending of ENDINGS) {
    if (normalized.length - ending.length >= 3 && normalized.endsWith(ending)) {
      return normalized.slice(0, -ending.length);
    }
  }
  return normalized;
}

export function searchObjects(query: string, catalog: Catalog, limit = 8): SearchHit[] {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const index = buildIndex(catalog);
  const queryTokens = normalized.split(' ').filter(Boolean).map(stem);
  const results = new Map<string, SearchHit>();

  for (const entry of index) {
    let best: { score: number; term: string } | null = null;
    for (const keyword of entry.keywords) {
      const keywordStem = stem(keyword);
      const keywordText = normalizeText(keyword);
      let score = 0;

      if (keywordText === normalized) score = 100;
      else if (keywordText.startsWith(normalized) || normalized.startsWith(keywordText)) {
        score = 82;
      } else if (keywordStem === stem(normalized)) score = 72;
      else if (queryTokens.some((token) => token === keywordStem)) score = 62;
      else if (queryTokens.some((token) => sharesPrefix(token, keywordStem))) score = 55;
      else if (queryTokens.some((token) => fuzzyDistance(token, keywordStem) <= 1)) score = 42;
      else if (
        queryTokens.some((token) => token.length >= 5 && fuzzyDistance(token, keywordStem) <= 2)
      ) {
        score = 26;
      }

      if (score > 0 && (!best || score > best.score)) {
        best = { score, term: keyword };
      }
      if (score === 100) break;
    }
    if (best) {
      const total = best.score + entry.object.meta.heroWeight * 0.4;
      results.set(entry.object.id, { object: entry.object, score: total, term: best.term });
    }
  }

  if (results.size === 0) {
    const fuse = getFuse(catalog);
    for (const match of fuse.search(normalized, { limit: 5 })) {
      if (match.score === undefined) continue;
      const entry = match.item;
      results.set(entry.object.id, {
        object: entry.object,
        score: 30 * (1 - match.score),
        term: normalized,
      });
    }
  }

  return [...results.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function resolveQuery(query: string, catalog: Catalog): QueryResolution {
  const parts = query
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const matched = new Map<string, SearchHit>();
  const unknown: string[] = [];
  const suggestions: SearchHit[] = [];

  for (const part of parts) {
    const hits = searchObjects(part, catalog, 3);
    const best = hits[0];
    if (best && best.score >= 40) {
      if (!matched.has(best.object.id)) matched.set(best.object.id, best);
    } else {
      unknown.push(part);
      for (const hit of hits) {
        if (!suggestions.some((item) => item.object.id === hit.object.id)) {
          suggestions.push(hit);
        }
      }
    }
  }

  return { matched: [...matched.values()], unknown, suggestions: suggestions.slice(0, 5) };
}

function buildIndex(catalog: Catalog): IndexEntry[] {
  const cached = indexCache.get(catalog);
  if (cached) return cached;
  const entries: IndexEntry[] = catalog.objects.map((object) => {
    const keywords = unique([
      object.nameRu,
      object.nameEn,
      ...object.meta.synonyms,
      ...object.meta.tags,
    ]);
    return { object, keywords };
  });
  indexCache.set(catalog, entries);
  return entries;
}

function getFuse(catalog: Catalog): Fuse<IndexEntry> {
  const cached = fuseCache.get(catalog);
  if (cached) return cached;
  const fuse = new Fuse(buildIndex(catalog), {
    keys: ['keywords'],
    threshold: 0.42,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 3,
  });
  fuseCache.set(catalog, fuse);
  return fuse;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sharesPrefix(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  return a.slice(0, 4) === b.slice(0, 4) && Math.abs(a.length - b.length) <= 4;
}

function fuzzyDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, (_, index) =>
    index === 0 ? Array.from({ length: cols }, (_, column) => column) : [index],
  );
  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < cols; column++) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost,
      );
    }
  }
  return matrix[rows - 1]![cols - 1]!;
}
