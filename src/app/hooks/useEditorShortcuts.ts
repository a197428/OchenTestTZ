import { useEffect } from 'react';
import { useEditor } from '../store/editor';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

export function useEditorShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditable(event.target)) return;
      const state = useEditor.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        state.redo();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        state.duplicateSelected();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (state.selectedId) {
          event.preventDefault();
          state.removeSelected();
        }
        return;
      }
      if (event.key === 'Escape') {
        state.select(null);
        return;
      }
      if (event.key === ']') {
        event.preventDefault();
        state.reorderSelected('forward');
        return;
      }
      if (event.key === '[') {
        event.preventDefault();
        state.reorderSelected('backward');
        return;
      }
      if (event.key.startsWith('Arrow') && state.selectedId) {
        const step = event.shiftKey ? 10 : 1;
        const deltas: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const delta = deltas[event.key];
        if (delta) {
          event.preventDefault();
          state.checkpoint();
          state.moveSelected(delta[0], delta[1]);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
