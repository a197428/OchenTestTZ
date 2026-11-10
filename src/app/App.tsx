import { useEffect, useState } from 'react';
import { parseScene } from '../core/scene';
import { SceneCanvas } from './canvas/SceneCanvas';
import { assetsPromise, type Assets } from './data/assets';
import { useEditorShortcuts } from './hooks/useEditorShortcuts';
import { ru } from './i18n';
import { InspectorPanel } from './panels/InspectorPanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { TopBar } from './panels/TopBar';
import { useEditor } from './store/editor';
import styles from './App.module.css';

const STORAGE_KEY = 'illustration-composer.scene.v1';

export function App() {
  const [assets, setAssets] = useState<Assets | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEditorShortcuts();

  useEffect(() => {
    let cancelled = false;
    assetsPromise
      .then((bundle) => {
        if (!cancelled) setAssets(bundle);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!assets) return;
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const scene = parseScene(JSON.parse(raw), assets.catalog);
      useEditor.getState().setScene(scene);
    } catch {
      // Corrupt autosave: keep the default scene.
    }
  }, [assets]);

  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.scene === previous.scene) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.scene));
        } catch {
          // Storage may be unavailable; editing still works.
        }
      }, 250);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  if (error) {
    return (
      <div className={styles.error}>
        <div className={styles.errorTitle}>{ru.editor.loadFailed}</div>
        <div className={styles.errorDetail}>{error}</div>
      </div>
    );
  }

  if (!assets) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} aria-hidden="true" />
        <div className={styles.loadingTitle}>{ru.editor.loading}</div>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <TopBar assets={assets} />
      <div className={styles.workspace}>
        <aside className={styles.left}>
          <LibraryPanel assets={assets} />
        </aside>
        <main className={styles.center}>
          <SceneCanvas assets={assets} />
        </main>
        <aside className={styles.right}>
          <InspectorPanel assets={assets} />
        </aside>
      </div>
    </div>
  );
}
