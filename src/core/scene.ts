import type { Catalog } from './catalog';
import { objectById, variantFor } from './catalog';
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
