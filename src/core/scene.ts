import type { Catalog } from './catalog';
import { objectById, variantFor } from './catalog';
import { FORMAT_IDS } from './layout/formats';
import type { DetailSize, FormatId, Instance, ObjectState, Scene } from './types';

export function createScene(
  format: FormatId = 'square',
  paletteId = 'purple',
  substrate: Scene['substrate'] = 'none',
): Scene {
  return {
    version: 1,
    format,
    size: 'L',
    paletteId,
    substrate,
    scale: 1,
    items: [],
  };
}

export function addItem(scene: Scene, item: Instance): Scene {
  return { ...scene, items: [...scene.items, item] };
}

export function removeItem(scene: Scene, id: string): Scene {
  return { ...scene, items: scene.items.filter((item) => item.id !== id) };
}

export function updateItem(
  scene: Scene,
  id: string,
  patch: Partial<Pick<Instance, 'x' | 'y' | 'rotation' | 'state' | 'locked'>>,
): Scene {
  return {
    ...scene,
    items: scene.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  };
}

export function duplicateItem(scene: Scene, id: string, newId: string, offset = 24): Scene {
  const index = scene.items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Item not found: ${id}`);
  const source = scene.items[index]!;
  const copy: Instance = {
    ...source,
    id: newId,
    x: source.x + offset,
    y: source.y + offset,
    locked: false,
  };
  const items = [...scene.items];
  items.splice(index + 1, 0, copy);
  return { ...scene, items };
}

export function reorderItem(scene: Scene, id: string, index: number): Scene {
  const current = scene.items.findIndex((item) => item.id === id);
  if (current < 0) throw new Error(`Item not found: ${id}`);
  const bounded = Math.max(0, Math.min(scene.items.length - 1, index));
  if (bounded === current) return scene;
  const items = [...scene.items];
  const [item] = items.splice(current, 1);
  if (!item) return scene;
  items.splice(bounded, 0, item);
  return { ...scene, items };
}

export function bringToFront(scene: Scene, id: string): Scene {
  return reorderItem(scene, id, scene.items.length - 1);
}

export function sendToBack(scene: Scene, id: string): Scene {
  return reorderItem(scene, id, 0);
}

export function moveForward(scene: Scene, id: string): Scene {
  const index = scene.items.findIndex((item) => item.id === id);
  return index < 0 ? scene : reorderItem(scene, id, index + 1);
}

export function moveBackward(scene: Scene, id: string): Scene {
  const index = scene.items.findIndex((item) => item.id === id);
  return index < 0 ? scene : reorderItem(scene, id, index - 1);
}

export function setItemState(scene: Scene, id: string, state: ObjectState): Scene {
  return updateItem(scene, id, { state });
}

export function toggleItemState(scene: Scene, id: string): Scene {
  const item = scene.items.find((candidate) => candidate.id === id);
  if (!item) return scene;
  return setItemState(scene, id, item.state === 'main' ? 'bg' : 'main');
}

export function setSceneSize(scene: Scene, size: DetailSize): Scene {
  return { ...scene, size };
}

export function setSceneScale(scene: Scene, scale: number): Scene {
  return { ...scene, scale: Math.max(0.3, Math.min(1.5, scale)) };
}

export function setFormat(scene: Scene, format: FormatId): Scene {
  return { ...scene, format };
}

export function setPalette(scene: Scene, paletteId: string): Scene {
  return { ...scene, paletteId };
}

export function setSubstrate(scene: Scene, substrate: Scene['substrate']): Scene {
  return { ...scene, substrate };
}

export function parseScene(raw: unknown, catalog: Catalog): Scene {
  if (!isRecord(raw)) throw new Error('Scene must be an object');
  if (raw.version !== 1) throw new Error('Unsupported scene version');
  if (typeof raw.format !== 'string' || !FORMAT_IDS.includes(raw.format as FormatId)) {
    throw new Error(`Invalid scene format: ${String(raw.format)}`);
  }
  if (raw.size !== 'S' && raw.size !== 'L') throw new Error('Invalid scene size');
  if (typeof raw.paletteId !== 'string') throw new Error('Invalid palette id');
  if (!catalog.palettes.some((palette) => palette.id === raw.paletteId)) {
    throw new Error(`Unknown palette: ${raw.paletteId}`);
  }
  if (raw.substrate !== 'confetti' && raw.substrate !== 'diagonal' && raw.substrate !== 'none') {
    throw new Error('Invalid substrate');
  }
  if (typeof raw.scale !== 'number' || !Number.isFinite(raw.scale) || raw.scale <= 0) {
    throw new Error('Invalid scene scale');
  }
  if (!Array.isArray(raw.items)) throw new Error('Scene items must be an array');

  const ids = new Set<string>();
  const items = raw.items.map((value, index): Instance => {
    if (!isRecord(value)) throw new Error(`Item ${index} must be an object`);
    if (typeof value.id !== 'string' || !value.id) throw new Error(`Item ${index} has no id`);
    if (ids.has(value.id)) throw new Error(`Duplicate item id: ${value.id}`);
    ids.add(value.id);
    if (typeof value.objectId !== 'string') throw new Error(`Item ${value.id} has no objectId`);
    if (value.state !== 'main' && value.state !== 'bg') {
      throw new Error(`Item ${value.id} has invalid state`);
    }
    if (
      typeof value.x !== 'number' ||
      !Number.isFinite(value.x) ||
      typeof value.y !== 'number' ||
      !Number.isFinite(value.y)
    ) {
      throw new Error(`Item ${value.id} has invalid position`);
    }
    if (typeof value.rotation !== 'number' || !Number.isFinite(value.rotation)) {
      throw new Error(`Item ${value.id} has invalid rotation`);
    }
    const object = objectById(catalog, value.objectId as Instance['objectId']);
    variantFor(object, value.state, raw.size as DetailSize);
    return {
      id: value.id,
      objectId: value.objectId as Instance['objectId'],
      state: value.state,
      x: value.x,
      y: value.y,
      rotation: value.rotation,
      ...(value.locked === true ? { locked: true } : {}),
    };
  });

  return {
    version: 1,
    format: raw.format as FormatId,
    size: raw.size,
    paletteId: raw.paletteId,
    substrate: raw.substrate,
    scale: raw.scale,
    items,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function validateScene(scene: Scene, catalog: Catalog): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(scene.scale) || scene.scale <= 0) {
    errors.push('Scene scale must be positive');
  }
  if (!catalog.palettes.some((palette) => palette.id === scene.paletteId)) {
    errors.push(`Unknown palette: ${scene.paletteId}`);
  }
  const ids = new Set<string>();
  for (const item of scene.items) {
    if (ids.has(item.id)) errors.push(`Duplicate item id: ${item.id}`);
    ids.add(item.id);
    try {
      const object = objectById(catalog, item.objectId);
      variantFor(object, item.state, scene.size);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) {
      errors.push(`Item ${item.id} has invalid position`);
    }
    if (!Number.isFinite(item.rotation)) {
      errors.push(`Item ${item.id} has invalid rotation`);
    }
  }
  return errors;
}
