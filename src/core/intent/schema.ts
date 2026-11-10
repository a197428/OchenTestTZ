import { z } from 'zod';
import type { Catalog } from '../catalog';

export const intentPickSchema = z.object({
  objectId: z.string().min(1),
  state: z.enum(['main', 'bg']),
  role: z.enum(['hero', 'support', 'backdrop']),
  reason: z.string().max(240).default(''),
});

export const intentSchema = z.object({
  concepts: z.array(z.string().max(60)).max(8).default([]),
  picks: z.array(intentPickSchema).min(1).max(6),
  fit: z.enum(['good', 'approximate', 'weak']),
  note: z.string().max(400).default(''),
});

export type IntentPick = z.infer<typeof intentPickSchema>;
export type ComposeIntent = z.infer<typeof intentSchema>;

export interface IntentValidation {
  ok: boolean;
  errors: string[];
}

export function validateIntent(intent: ComposeIntent, catalog: Catalog): IntentValidation {
  const errors: string[] = [];
  const known = new Set<string>(catalog.objects.map((object) => object.id));
  const ids = new Set<string>();
  let heroes = 0;

  for (const pick of intent.picks) {
    if (!known.has(pick.objectId)) {
      errors.push(`Unknown object: ${pick.objectId}`);
    }
    if (ids.has(pick.objectId)) {
      errors.push(`Duplicate object: ${pick.objectId}`);
    }
    ids.add(pick.objectId);
    if (pick.role === 'hero') heroes++;
    if (pick.role === 'backdrop' && pick.state !== 'bg') {
      errors.push(`Backdrop must use bg state: ${pick.objectId}`);
    }
  }

  if (heroes !== 1) errors.push(`Expected exactly one hero, got ${heroes}`);
  return { ok: errors.length === 0, errors };
}

export function parseIntent(raw: unknown): ComposeIntent {
  return intentSchema.parse(raw);
}
