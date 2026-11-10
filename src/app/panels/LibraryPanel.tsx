import { useState } from 'react';
import { variantFor, type CatalogObject } from '../../core/catalog';
import { matrixToSvg } from '../../core/geometry';
import { FORMATS } from '../../core/layout/formats';
import { recolorFragment } from '../../core/recolor';
import type { ObjectState } from '../../core/types';
import type { Assets } from '../data/assets';
import { ru } from '../i18n';
import { useEditor } from '../store/editor';
import styles from './LibraryPanel.module.css';

interface Props {
  assets: Assets;
}

export function LibraryPanel({ assets }: Props) {
  const [tab, setTab] = useState<'meaning' | 'names'>('meaning');
  const [mode, setMode] = useState<ObjectState>('main');
  const [meaning, setMeaning] = useState('');
  const [names, setNames] = useState('');
  const scene = useEditor((state) => state.scene);
  const addObject = useEditor((state) => state.addObject);

  const add = (object: CatalogObject): void => {
    const variant = variantFor(object, mode, scene.size);
    const frame = FORMATS[scene.format];
    const offset = ((scene.items.length % 5) - 2) * 22;
    const x = (frame.width - variant.bbox.w) / 2 + offset;
    const y = (frame.height - variant.bbox.h) / 2 + offset;
    addObject(object.id, mode, x, y);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist" aria-label={ru.editor.tabs.label}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'meaning'}
          className={styles.tab}
          onClick={() => setTab('meaning')}
        >
          {ru.editor.tabs.meaning}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'names'}
          className={styles.tab}
          onClick={() => setTab('names')}
        >
          {ru.editor.tabs.names}
        </button>
      </div>

      <div className={styles.tabBody}>
        {tab === 'meaning' ? (
          <label className={styles.inputBlock}>
            <span className="fieldLabel">{ru.editor.meaning.title}</span>
            <input
              className="field"
              value={meaning}
              onChange={(event) => setMeaning(event.target.value)}
              placeholder={ru.editor.meaning.placeholder}
            />
            <button type="button" className="btn btnPrimary" disabled>
              {ru.editor.meaning.submit}
            </button>
            <span className={styles.note}>{ru.editor.meaning.note}</span>
          </label>
        ) : (
          <label className={styles.inputBlock}>
            <span className="fieldLabel">{ru.editor.names.title}</span>
            <input
              className="field"
              value={names}
              onChange={(event) => setNames(event.target.value)}
              placeholder={ru.editor.names.placeholder}
            />
            <span className={styles.note}>{ru.editor.names.note}</span>
          </label>
        )}
      </div>

      <div className={styles.libraryHead}>
        <span className={styles.libraryTitle}>{ru.editor.library.title}</span>
        <div className="seg" role="group" aria-label={ru.editor.library.stateLabel}>
          <button
            type="button"
            className="segButton"
            aria-pressed={mode === 'main'}
            onClick={() => setMode('main')}
          >
            {ru.editor.library.main}
          </button>
          <button
            type="button"
            className="segButton"
            aria-pressed={mode === 'bg'}
            onClick={() => setMode('bg')}
          >
            {ru.editor.library.bg}
          </button>
        </div>
      </div>
      <p className={styles.hint}>{ru.editor.library.hint}</p>

      <div className={styles.grid}>
        {assets.catalog.objects.map((object) => (
          <button
            key={object.id}
            type="button"
            className={styles.card}
            data-object={object.id}
            title={
              mode === 'main'
                ? `${ru.editor.library.addMain}: ${object.nameRu}`
                : `${ru.editor.library.addBg}: ${object.nameRu}`
            }
            onClick={() => add(object)}
          >
            <Thumbnail object={object} assets={assets} />
            <span className={styles.cardName}>{object.nameRu}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Thumbnail({ object, assets }: { object: CatalogObject; assets: Assets }) {
  const variant = object.variants.find((item) => item.state === 'main' && item.size === 'L');
  if (!variant) return <span className={styles.thumb} />;
  const fragments = assets.fragments.get(variant.key) ?? [];
  const palette = assets.catalog.palettes.find((item) => item.id === 'purple');
  return (
    <svg
      className={styles.thumb}
      viewBox={`0 0 ${variant.bbox.w} ${variant.bbox.h}`}
      aria-hidden="true"
      focusable="false"
    >
      <g transform={matrixToSvg(variant.toNative)}>
        {fragments.map((fragment, index) => {
          const colors = palette ? recolorFragment(fragment, palette) : {};
          return (
            <path
              key={index}
              d={fragment.d}
              fill={colors.fill ?? 'none'}
              stroke={colors.stroke}
              {...fragment.attrs}
            />
          );
        })}
      </g>
    </svg>
  );
}
