import { describe, expect, it } from 'vitest';
import { fallbackIntent } from '../../src/core/intent/fallback';
import { intentSchema, validateIntent } from '../../src/core/intent/schema';
import { normalizeText, resolveQuery, searchObjects, stem } from '../../src/core/intent/search';
import { loadCatalog } from '../helpers/assets';

const catalog = loadCatalog();

const expectations: { query: string; expected: string[] }[] = [
  { query: 'обучение', expected: ['book'] },
  { query: 'чтение', expected: ['book'] },
  { query: 'учеба', expected: ['book'] },
  { query: 'учёба', expected: ['book'] },
  { query: 'знания', expected: ['book'] },
  { query: 'телефон', expected: ['phone'] },
  { query: 'связь', expected: ['phone'] },
  { query: 'музыка', expected: ['headphones'] },
  { query: 'подкаст', expected: ['headphones'] },
  { query: 'деньги', expected: ['wallet', 'coin'] },
  { query: 'финансы', expected: ['coin', 'wallet'] },
  { query: 'покупки', expected: ['wallet'] },
  { query: 'идея', expected: ['lamp'] },
  { query: 'свет', expected: ['lamp'] },
  { query: 'подарок', expected: ['tulips'] },
  { query: 'цветы', expected: ['tulips'] },
  { query: 'документы', expected: ['folder'] },
  { query: 'архив', expected: ['folder'] },
  { query: 'письмо', expected: ['pen'] },
  { query: 'заметки', expected: ['pen'] },
  { query: 'задача', expected: ['puzzle'] },
  { query: 'решение', expected: ['puzzle'] },
  { query: 'телефн', expected: ['phone'] },
  { query: 'кашелёк', expected: ['wallet'] },
];

describe('search', () => {
  it('normalizes case and ё', () => {
    expect(normalizeText('  УЧЁБА ')).toBe('учеба');
    expect(stem('обучения')).toBe(stem('обучение'));
  });

  it.each(expectations)('finds $query', ({ query, expected }) => {
    const hits = searchObjects(query, catalog, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(expected).toContain(hits[0]!.object.id);
  });

  it('resolves several comma-separated names', () => {
    const result = resolveQuery('телефон, книга', catalog);
    expect(result.matched.map((hit) => hit.object.id).sort()).toEqual(['book', 'phone']);
    expect(result.unknown).toEqual([]);
  });

  it('reports unknown words with suggestions', () => {
    const result = resolveQuery('космос, телефн', catalog);
    expect(result.unknown).toContain('космос');
    expect(result.matched.map((hit) => hit.object.id)).toContain('phone');
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});

describe('fallback intent', () => {
  it.each(expectations.slice(0, 20))('builds a valid intent for $query', ({ query }) => {
    const intent = fallbackIntent(query, catalog);
    expect(intent.picks.length).toBeGreaterThanOrEqual(1);
    expect(intent.picks.length).toBeLessThanOrEqual(6);
    expect(intent.picks.filter((pick) => pick.role === 'hero')).toHaveLength(1);
    expect(validateIntent(intent, catalog).errors).toEqual([]);
    expect(['good', 'approximate', 'weak']).toContain(intent.fit);
  });

  it('maps key concepts to the expected objects', () => {
    expect(fallbackIntent('обучение', catalog).picks[0]!.objectId).toBe('book');
    const money = fallbackIntent('деньги', catalog).picks.map((pick) => pick.objectId);
    expect(money.some((id) => id === 'wallet' || id === 'coin')).toBe(true);
    expect(fallbackIntent('идея', catalog).picks[0]!.objectId).toBe('lamp');
  });

  it('degrades honestly for an unrelated metaphor', () => {
    const intent = fallbackIntent('космический корабль', catalog);
    expect(intent.picks.length).toBeGreaterThan(0);
    expect(intent.fit).toBe('weak');
    expect(intent.note).toBe('');
  });
});

describe('intent schema', () => {
  it('rejects duplicate heroes and unknown ids', () => {
    const raw = {
      concepts: ['x'],
      picks: [
        { objectId: 'book', state: 'main', role: 'hero', reason: '' },
        { objectId: 'phone', state: 'main', role: 'hero', reason: '' },
        { objectId: 'unknown', state: 'main', role: 'support', reason: '' },
      ],
      fit: 'good',
      note: '',
    };
    const parsed = intentSchema.parse(raw);
    const errors = validateIntent(parsed, catalog).errors;
    expect(errors.some((error) => error.includes('hero'))).toBe(true);
    expect(errors.some((error) => error.includes('Unknown object'))).toBe(true);
  });

  it('rejects backdrop in main state', () => {
    const intent = intentSchema.parse({
      concepts: [],
      picks: [
        { objectId: 'book', state: 'main', role: 'backdrop', reason: '' },
        { objectId: 'phone', state: 'main', role: 'hero', reason: '' },
      ],
      fit: 'good',
      note: '',
    });
    expect(validateIntent(intent, catalog).errors).toContain('Backdrop must use bg state: book');
  });

  it('rejects malformed responses', () => {
    expect(() =>
      intentSchema.parse({ picks: [{ objectId: 'book', state: 'main', role: 'nope' }] }),
    ).toThrow();
    expect(() => intentSchema.parse({ picks: [] })).toThrow();
  });
});
