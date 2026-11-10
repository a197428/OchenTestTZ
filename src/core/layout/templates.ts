import type { ObjectId, Scene } from '../types';
import type { LayoutItemRequest, LayoutRequest, TemplateData } from './types';

export function templateObjectSet(template: TemplateData): Set<ObjectId> {
  return new Set(template.items.map((item) => item.objectId));
}

export function selectTemplate(
  request: LayoutRequest,
  templates: readonly TemplateData[],
  random: () => number,
): TemplateData | null {
  const requested = new Set(request.items.map((item) => item.objectId));
  if (requested.size !== request.items.length || requested.size < 2) return null;
  if (request.headlineSpace && request.headlineSpace !== 'none') return null;
  if (request.backdrop === 'on') return null;

  const candidates: { template: TemplateData; score: number }[] = [];
  for (const template of templates) {
    if (template.format !== request.format) continue;
    if (template.items.length < 2) continue;
    const set = templateObjectSet(template);
    if (![...requested].every((id) => set.has(id))) continue;
    const exact = set.size === requested.size;
    const score = exact ? 10_000 : requested.size * 100 - (set.size - requested.size);
    candidates.push({ template, score });
  }
  if (candidates.length === 0) return null;

  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  const best = candidates.filter((candidate) => candidate.score === bestScore);
  const index = Math.min(best.length - 1, Math.floor(random() * best.length));
  return best[index]!.template;
}

export function layoutFromTemplate(request: LayoutRequest, template: TemplateData): Scene {
  const requested = new Map<ObjectId, LayoutItemRequest>();
  for (const item of request.items) requested.set(item.objectId, item);

  const items = template.items
    .filter((item) => requested.has(item.objectId))
    .sort((a, b) => a.z - b.z)
    .map((item, index) => ({
      id: `${template.id}-${index}-${item.objectId}`,
      objectId: item.objectId,
      state: requested.get(item.objectId)?.state ?? item.state,
      x: item.x,
      y: item.y,
      rotation: 0,
    }));

  return {
    version: 1,
    format: request.format,
    size: request.size,
    paletteId: request.paletteId ?? 'purple',
    substrate: request.substrate ?? template.substrate,
    scale: request.scale ?? 1,
    items,
  };
}
