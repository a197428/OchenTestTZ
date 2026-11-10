import { useEffect, useRef, useState } from 'react';
import { parsePalette, validatePalette } from '../../core/palette';
import { SLOTS } from '../../core/slots';
import type { Palette, Slot } from '../../core/types';
import type { Assets } from '../data/assets';
import { registerCustomPalette } from '../data/customPalettes';
import { ru } from '../i18n';
import styles from './PaletteDialog.module.css';

interface Props {
  assets: Assets;
  onClose: () => void;
  onApplied: (paletteId: string) => void;
}

export function PaletteDialog({ assets, onClose, onApplied }: Props) {
  const [customId] = useState(() => `custom-${Date.now().toString(36)}`);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Palette | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const parse = (): void => {
    try {
      const result = parsePalette(text, {
        id: customId,
        name: ru.editor.paletteDialog.customName,
      });
      const palette: Palette = {
        ...result.palette,
        id: customId,
        name: result.palette.name || ru.editor.paletteDialog.customName,
        builtin: false,
      };
      setDraft(palette);
      setWarnings(result.warnings);
      setError(null);
    } catch (cause) {
      setDraft(null);
      setWarnings([]);
      setError(cause instanceof Error ? cause.message : ru.editor.paletteDialog.error);
    }
  };

  const updateSlot = (slot: Slot, value: string): void => {
    if (!draft) return;
    const next: Palette = {
      ...draft,
      slots: { ...draft.slots, [slot]: value.toUpperCase() },
    };
    setDraft(next);
    setWarnings(validatePalette(next));
  };

  const apply = (): void => {
    if (!draft) return;
    registerCustomPalette(assets.catalog, draft);
    onApplied(draft.id);
  };

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={ru.editor.paletteDialog.title}
        data-testid="palette-dialog"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{ru.editor.paletteDialog.title}</h2>
          <button
            type="button"
            className="btn btnIcon"
            onClick={onClose}
            aria-label={ru.editor.paletteDialog.cancel}
          >
            ×
          </button>
        </header>

        <p className={styles.hint}>{ru.editor.paletteDialog.hint}</p>
        <textarea
          className={`field ${styles.textarea}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={ru.editor.paletteDialog.placeholder}
          data-testid="palette-input"
          rows={5}
        />

        <div className={styles.actions}>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            {ru.editor.paletteDialog.file}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json,.txt,.css"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void file.text().then((value) => setText(value));
              }
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn btnPrimary"
            onClick={parse}
            disabled={!text.trim()}
            data-action="parse-palette"
          >
            {ru.editor.paletteDialog.parse}
          </button>
        </div>

        {error ? (
          <div className={styles.error} role="alert">
            {ru.editor.paletteDialog.error}: {error}
          </div>
        ) : null}

        {draft ? (
          <div className={styles.slots}>
            <div className="fieldLabel">{ru.editor.paletteDialog.slots}</div>
            {SLOTS.map((slot) => (
              <label key={slot} className={styles.slot}>
                <span className={styles.slotName}>{slot}</span>
                <input
                  type="color"
                  className={styles.color}
                  value={draft.slots[slot]}
                  onChange={(event) => updateSlot(slot, event.target.value)}
                  aria-label={slot}
                />
                <span className={styles.hex}>{draft.slots[slot]}</span>
              </label>
            ))}
            {warnings.length > 0 ? (
              <div className={styles.warnings}>
                <strong>{ru.editor.paletteDialog.warnings}:</strong>
                <ul>
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <footer className={styles.footer}>
          <button type="button" className="btn" onClick={onClose}>
            {ru.editor.paletteDialog.cancel}
          </button>
          <button
            type="button"
            className="btn btnPrimary"
            disabled={!draft}
            onClick={apply}
            data-action="apply-palette"
          >
            {ru.editor.paletteDialog.apply}
          </button>
        </footer>
      </div>
    </div>
  );
}
