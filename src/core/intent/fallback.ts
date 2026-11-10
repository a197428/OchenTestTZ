import type { Catalog } from '../catalog';
import type { ComposeIntent, IntentPick } from './schema';
import { searchObjects } from './search';

export function fallbackIntent(text: string, catalog: Catalog): ComposeIntent {
  const hits = searchObjects(text, catalog, 6);
  const picks: IntentPick[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    if (hit.score < 20) continue;
    if (seen.has(hit.object.id)) continue;
    seen.add(hit.object.id);
    picks.push({
      objectId: hit.object.id,
      state: 'main',
      role: picks.length === 0 ? 'hero' : 'support',
      reason: hit.term,
    });
    if (picks.length >= 5) break;
  }

  if (picks.length < 3) {
    const extras = [...catalog.objects]
      .filter((object) => !seen.has(object.id))
      .sort((a, b) => b.meta.heroWeight - a.meta.heroWeight);
    for (const object of extras) {
      if (picks.length >= 3) break;
      picks.push({
        objectId: object.id,
        state: 'main',
        role: picks.length === 0 ? 'hero' : 'support',
        reason: '',
      });
    }
  }

  if (picks.length === 0) {
    const object = [...catalog.objects].sort((a, b) => b.meta.heroWeight - a.meta.heroWeight)[0]!;
    picks.push({ objectId: object.id, state: 'main', role: 'hero', reason: '' });
  }

  const bestScore = hits[0]?.score ?? 0;
  const fit: ComposeIntent['fit'] =
    bestScore >= 80 && picks.length >= 2 ? 'good' : bestScore >= 40 ? 'approximate' : 'weak';

  const concepts = [...new Set(hits.slice(0, 4).map((hit) => hit.term))];

  return { concepts, picks, fit, note: '' };
}
