import { useEffect, useMemo, useRef, useState } from 'react';
import { parseScene } from '../../core/scene';
import { lintExport } from '../../core/export/lint';
import { exportScene } from '../../core/export/svg';
import { FORMATS } from '../../core/layout/formats';
import type { Assets } from '../data/assets';
import { ru } from '../i18n';
import { canRedo, canUndo, useEditor } from '../store/editor';
import styles from './TopBar.module.css';

interface Props {
  assets: Assets;
}

export function TopBar({ assets }: Props) {
  const scene = useEditor((state) => state.scene);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const undoAvailable = useEditor(canUndo);
  const redoAvailable = useEditor(canRedo);
  const setScene = useEditor((state) => state.setScene);
  const [status, setStatus] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 3500);
    return () => window.clearTimeout(timer);
  }, [status]);

  const allowedD = useMemo(() => {
    const set = new Set<string>();
    for (const paths of assets.fragments.values()) {
      for (const fragment of paths) set.add(fragment.d);
    }
    for (const substrate of assets.substrates) {
      for (const format of Object.values(substrate.byFormat)) {
        for (const element of format.elements) {
          if (element.tag === 'path' && element.d) set.add(element.d);
        }
      }
    }
    return set;
  }, [assets]);

  const buildSvg = (): string | null => {
    try {
      const svg = exportScene(scene, {
        catalog: assets.catalog,
        fragments: assets.fragments,
        substrates: assets.substrates,
      });
      const frame = FORMATS[scene.format];
      const lint = lintExport(svg, {
        width: frame.width,
        height: frame.height,
        idPrefix: 'ic1-',
        allowedD,
      });
      if (!lint.ok) {
        setStatus(`${ru.editor.top.exportFailed}: ${lint.errors[0] ?? ''}`);
        return null;
      }
      return svg;
    } catch (cause) {
      setStatus(
        `${ru.editor.top.exportFailed}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return null;
    }
  };

  const downloadSvg = (): void => {
    const svg = buildSvg();
    if (!svg) return;
    download(`${scene.format}-${scene.paletteId}.svg`, svg, 'image/svg+xml');
  };

  const copySvg = async (): Promise<void> => {
    const svg = buildSvg();
    if (!svg) return;
    try {
      await navigator.clipboard.writeText(svg);
      setStatus(ru.editor.top.copied);
    } catch {
      setStatus(ru.editor.top.copyFailed);
    }
  };

  const downloadScene = (): void => {
    download('scene.json', `${JSON.stringify(scene, null, 2)}\n`, 'application/json');
  };

  const importScene = async (file: File): Promise<void> => {
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      setScene(parseScene(raw, assets.catalog));
      setStatus(null);
    } catch {
      setStatus(ru.editor.top.importFailed);
    }
  };

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true" />
        <span className={styles.name}>Illustration Composer</span>
      </div>

      <div className={styles.group}>
        <button
          type="button"
          className="btn btnIcon"
          onClick={undo}
          disabled={!undoAvailable}
          aria-label={ru.editor.top.undo}
          title={`${ru.editor.top.undo} (Ctrl+Z)`}
          data-action="undo"
        >
          ↶
        </button>
        <button
          type="button"
          className="btn btnIcon"
          onClick={redo}
          disabled={!redoAvailable}
          aria-label={ru.editor.top.redo}
          title={`${ru.editor.top.redo} (Ctrl+Shift+Z)`}
          data-action="redo"
        >
          ↷
        </button>
      </div>

      <div className={styles.group}>
        <button
          type="button"
          className="btn"
          onClick={downloadSvg}
          title={ru.editor.top.download}
          data-action="download"
        >
          {ru.editor.top.download}
        </button>
        <button type="button" className="btn" onClick={() => void copySvg()} data-action="copy">
          {ru.editor.top.copy}
        </button>
        <button type="button" className="btn" onClick={downloadScene} data-action="scene">
          {ru.editor.top.sceneJson}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => fileInput.current?.click()}
          data-action="import"
        >
          {ru.editor.top.importScene}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importScene(file);
            event.target.value = '';
          }}
        />
      </div>

      <div className={styles.spacer} />
      {status ? (
        <div className={styles.status} role="status">
          {status}
        </div>
      ) : null}
      <button type="button" className="btn" disabled title={ru.editor.top.moreSoon}>
        {ru.editor.top.more}
      </button>
    </header>
  );
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
