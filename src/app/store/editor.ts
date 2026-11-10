import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  bringToFront,
  createScene,
  duplicateItem,
  moveBackward,
  moveForward,
  reorderItem,
  sendToBack,
} from '../../core/scene';
import type {
  DetailSize,
  FormatId,
  Instance,
  ObjectId,
  ObjectState,
  Scene,
} from '../../core/types';

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export type ReorderMode = 'front' | 'forward' | 'backward' | 'back';

interface History {
  past: Scene[];
  future: Scene[];
}

interface EditorState {
  scene: Scene;
  selectedId: string | null;
  viewport: Viewport;
  history: History;
  select: (id: string | null) => void;
  checkpoint: () => void;
  addObject: (objectId: ObjectId, state: ObjectState, x: number, y: number) => void;
  setItemPosition: (id: string, x: number, y: number) => void;
  moveSelected: (dx: number, dy: number) => void;
  setRotation: (id: string, degrees: number) => void;
  toggleState: () => void;
  duplicateSelected: () => void;
  removeSelected: () => void;
  reorderSelected: (mode: ReorderMode) => void;
  reorderToIndex: (id: string, index: number) => void;
  setFormat: (format: FormatId) => void;
  setSize: (size: DetailSize) => void;
  setPalette: (paletteId: string) => void;
  setSubstrate: (substrate: Scene['substrate']) => void;
  setScale: (scale: number) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  undo: () => void;
  redo: () => void;
  setScene: (scene: Scene) => void;
}

let idCounter = 0;

export function nextInstanceId(): string {
  idCounter += 1;
  return `inst-${idCounter.toString(36)}-${Date.now().toString(36)}`;
}

function cloneScene(scene: Scene): Scene {
  return JSON.parse(JSON.stringify(scene)) as Scene;
}

function pushHistory(state: EditorState): void {
  const current = JSON.stringify(state.scene);
  const previous = state.history.past[state.history.past.length - 1];
  if (previous && JSON.stringify(previous) === current) return;
  state.history.past.push(cloneScene(state.scene));
  if (state.history.past.length > 100) state.history.past.shift();
  state.history.future = [];
}

function selectedIndex(scene: Scene, id: string | null): number {
  if (!id) return -1;
  return scene.items.findIndex((item) => item.id === id);
}

export const useEditor = create<EditorState>()(
  immer((set) => ({
    scene: createScene('square', 'purple', 'diagonal'),
    selectedId: null,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    history: { past: [], future: [] },

    select: (id) =>
      set((state) => {
        state.selectedId = id;
      }),

    checkpoint: () =>
      set((state) => {
        pushHistory(state);
      }),

    addObject: (objectId, objectState, x, y) =>
      set((state) => {
        pushHistory(state);
        const item: Instance = {
          id: nextInstanceId(),
          objectId,
          state: objectState,
          x,
          y,
          rotation: 0,
        };
        state.scene.items.push(item);
        state.selectedId = item.id;
      }),

    setItemPosition: (id, x, y) =>
      set((state) => {
        const item = state.scene.items.find((candidate) => candidate.id === id);
        if (!item) return;
        item.x = x;
        item.y = y;
      }),

    moveSelected: (dx, dy) =>
      set((state) => {
        const item = state.scene.items.find((candidate) => candidate.id === state.selectedId);
        if (!item) return;
        item.x += dx;
        item.y += dy;
      }),

    setRotation: (id, degrees) =>
      set((state) => {
        const item = state.scene.items.find((candidate) => candidate.id === id);
        if (!item) return;
        item.rotation = Number.isFinite(degrees) ? degrees : 0;
      }),

    toggleState: () =>
      set((state) => {
        const item = state.scene.items.find((candidate) => candidate.id === state.selectedId);
        if (!item) return;
        pushHistory(state);
        item.state = item.state === 'main' ? 'bg' : 'main';
      }),

    duplicateSelected: () =>
      set((state) => {
        if (!state.selectedId) return;
        pushHistory(state);
        const copy = duplicateItem(state.scene, state.selectedId, nextInstanceId());
        state.scene = copy;
        const sourceIndex = state.scene.items.findIndex((item) => item.id === state.selectedId);
        const copyIndex = sourceIndex >= 0 ? sourceIndex + 1 : state.scene.items.length - 1;
        state.selectedId = state.scene.items[copyIndex]?.id ?? null;
      }),

    removeSelected: () =>
      set((state) => {
        if (!state.selectedId) return;
        pushHistory(state);
        state.scene.items = state.scene.items.filter((item) => item.id !== state.selectedId);
        state.selectedId = null;
      }),

    reorderSelected: (mode) =>
      set((state) => {
        if (!state.selectedId) return;
        pushHistory(state);
        const id = state.selectedId;
        switch (mode) {
          case 'front':
            state.scene = bringToFront(state.scene, id);
            break;
          case 'back':
            state.scene = sendToBack(state.scene, id);
            break;
          case 'forward':
            state.scene = moveForward(state.scene, id);
            break;
          case 'backward':
            state.scene = moveBackward(state.scene, id);
            break;
        }
      }),

    reorderToIndex: (id, index) =>
      set((state) => {
        if (selectedIndex(state.scene, id) < 0) return;
        pushHistory(state);
        state.scene = reorderItem(state.scene, id, index);
      }),

    setFormat: (format) =>
      set((state) => {
        if (state.scene.format === format) return;
        pushHistory(state);
        state.scene.format = format;
      }),

    setSize: (size) =>
      set((state) => {
        if (state.scene.size === size) return;
        pushHistory(state);
        state.scene.size = size;
      }),

    setPalette: (paletteId) =>
      set((state) => {
        if (state.scene.paletteId === paletteId) return;
        pushHistory(state);
        state.scene.paletteId = paletteId;
      }),

    setSubstrate: (substrate) =>
      set((state) => {
        if (state.scene.substrate === substrate) return;
        pushHistory(state);
        state.scene.substrate = substrate;
      }),

    setScale: (scale) =>
      set((state) => {
        state.scene.scale = Math.max(0.3, Math.min(1.5, scale));
      }),

    setViewport: (viewport) =>
      set((state) => {
        Object.assign(state.viewport, viewport);
      }),

    undo: () =>
      set((state) => {
        const previous = state.history.past.pop();
        if (!previous) return;
        state.history.future.push(cloneScene(state.scene));
        state.scene = previous;
        if (state.selectedId && !state.scene.items.some((item) => item.id === state.selectedId)) {
          state.selectedId = null;
        }
      }),

    redo: () =>
      set((state) => {
        const next = state.history.future.pop();
        if (!next) return;
        state.history.past.push(cloneScene(state.scene));
        state.scene = next;
        if (state.selectedId && !state.scene.items.some((item) => item.id === state.selectedId)) {
          state.selectedId = null;
        }
      }),

    setScene: (scene) =>
      set((state) => {
        state.scene = cloneScene(scene);
        state.selectedId = null;
        state.history = { past: [], future: [] };
        state.viewport = { zoom: 1, panX: 0, panY: 0 };
      }),
  })),
);

export function selectedItem(state: EditorState): Instance | null {
  return state.scene.items.find((item) => item.id === state.selectedId) ?? null;
}

export function canUndo(state: EditorState): boolean {
  return state.history.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.history.future.length > 0;
}
