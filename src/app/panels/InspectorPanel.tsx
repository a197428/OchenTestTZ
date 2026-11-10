import { useRef } from 'react';
import { objectById } from '../../core/catalog';
import { FORMAT_IDS } from '../../core/layout/formats';
import type { DetailSize, FormatId } from '../../core/types';
import type { Assets } from '../data/assets';
import { layoutScene } from '../editor/layoutScene';
import { ru } from '../i18n';
import { useEditor } from '../store/editor';
import styles from './InspectorPanel.module.css';

interface Props {
  assets: Assets;
}

const FORMAT_LABEL: Record<FormatId, string> = {
  square: ru.editor.formats.square,
  wide: ru.editor.formats.wide,
  tall: ru.editor.formats.tall,
};

const FORMAT_DIMENSION: Record<FormatId, string> = {
  square: ru.editor.formats.squareDim,
  wide: ru.editor.formats.wideDim,
  tall: ru.editor.formats.tallDim,
};

export function InspectorPanel({ assets }: Props) {
  const scene = useEditor((state) => state.scene);
  const selectedId = useEditor((state) => state.selectedId);
  const setSize = useEditor((state) => state.setSize);
  const setPalette = useEditor((state) => state.setPalette);
  const setSubstrate = useEditor((state) => state.setSubstrate);
  const setScale = useEditor((state) => state.setScale);
  const checkpoint = useEditor((state) => state.checkpoint);
  const select = useEditor((state) => state.select);
  const reorderSelected = useEditor((state) => state.reorderSelected);
  const reorderToIndex = useEditor((state) => state.reorderToIndex);
  const toggleState = useEditor((state) => state.toggleState);
  const duplicateSelected = useEditor((state) => state.duplicateSelected);
  const removeSelected = useEditor((state) => state.removeSelected);
  const setItemPosition = useEditor((state) => state.setItemPosition);
  const setRotation = useEditor((state) => state.setRotation);
  const layoutSeed = useEditor((state) => state.layoutSeed);
  const bgMode = useEditor((state) => state.bgMode);
  const setBgMode = useEditor((state) => state.setBgMode);
  const applyLayout = useEditor((state) => state.applyLayout);
  const dragId = useRef<string | null>(null);

  const item = scene.items.find((candidate) => candidate.id === selectedId) ?? null;
  const object = item ? objectById(assets.catalog, item.objectId) : null;
  const rotationWarning = item ? Math.abs(item.rotation % 360) > 0.001 : false;

  const changeFormat = (format: FormatId): void => {
    if (format === scene.format) return;
    if (scene.items.length > 0 && !window.confirm(ru.editor.confirmFormat)) return;
    applyLayout(layoutScene(scene, assets, { format, seed: layoutSeed, bgMode }));
  };

  const changeBgMode = (mode: 'auto' | 'on' | 'off'): void => {
    setBgMode(mode);
    if (scene.items.length === 0) return;
    applyLayout(layoutScene(scene, assets, { seed: layoutSeed, bgMode: mode }));
  };

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <h2 className="fieldLabel">{ru.editor.inspector.format}</h2>
        <div className={styles.formats}>
          {FORMAT_IDS.map((format) => (
            <button
              key={format}
              type="button"
              className={styles.formatButton}
              aria-pressed={scene.format === format}
              data-format={format}
              onClick={() => changeFormat(format)}
            >
              <span>{FORMAT_LABEL[format]}</span>
              <span className={styles.dim}>{FORMAT_DIMENSION[format]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className="fieldLabel">{ru.editor.inspector.size}</h2>
        <div className="seg">
          {(['L', 'S'] as DetailSize[]).map((size) => (
            <button
              key={size}
              type="button"
              className="segButton"
              aria-pressed={scene.size === size}
              data-size={size}
              onClick={() => setSize(size)}
            >
              {ru.editor.sizes[size]}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className="fieldLabel">{ru.editor.inspector.palette}</h2>
        <div className={styles.palettes}>
          {assets.catalog.palettes.map((palette) => (
            <button
              key={palette.id}
              type="button"
              className={styles.paletteButton}
              aria-pressed={scene.paletteId === palette.id}
              data-palette={palette.id}
              onClick={() => setPalette(palette.id)}
            >
              <span
                className={styles.swatch}
                style={{
                  background: `linear-gradient(135deg, ${palette.slots['bg-light']}, ${palette.slots['bg-mid']} 55%, ${palette.slots['obj-1']})`,
                }}
                aria-hidden="true"
              />
              <span>
                {(ru.editor.palettes as Record<string, string>)[palette.id] ?? palette.name}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className="fieldLabel">{ru.editor.inspector.substrate}</h2>
        <div className="seg">
          {(['confetti', 'diagonal', 'none'] as const).map((substrate) => (
            <button
              key={substrate}
              type="button"
              className="segButton"
              aria-pressed={scene.substrate === substrate}
              data-substrate={substrate}
              onClick={() => setSubstrate(substrate)}
            >
              {ru.editor.substrates[substrate]}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className="fieldLabel">{ru.editor.inspector.scale}</h2>
        <div className={styles.scaleRow}>
          <input
            type="range"
            min={0.3}
            max={1.5}
            step={0.01}
            value={scene.scale}
            onPointerDown={checkpoint}
            onKeyDown={checkpoint}
            onChange={(event) => setScale(Number(event.target.value))}
            aria-label={ru.editor.inspector.scale}
          />
          <span className={styles.scaleValue}>{Math.round(scene.scale * 100)}%</span>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className="fieldLabel">{ru.editor.inspector.bgObjects}</h2>
        <div className="seg" title={ru.editor.inspector.bgHint}>
          {(['auto', 'on', 'off'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="segButton"
              aria-pressed={bgMode === mode}
              data-bg-mode={mode}
              onClick={() => changeBgMode(mode)}
            >
              {ru.editor.bgMode[mode]}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className="fieldLabel">{ru.editor.inspector.layers}</h2>
        {scene.items.length === 0 ? (
          <p className={styles.empty}>{ru.editor.inspector.noLayers}</p>
        ) : (
          <ul className={styles.layers}>
            {[...scene.items].reverse().map((layer, displayIndex) => {
              const layerObject = assets.catalog.objects.find(
                (candidate) => candidate.id === layer.objectId,
              );
              return (
                <li
                  key={layer.id}
                  className={`${styles.layer} ${layer.id === selectedId ? styles.layerSelected : ''}`}
                  data-layer-id={layer.id}
                  draggable
                  onDragStart={() => {
                    dragId.current = layer.id;
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (!dragId.current) return;
                    reorderToIndex(dragId.current, scene.items.length - 1 - displayIndex);
                    dragId.current = null;
                  }}
                >
                  <button
                    type="button"
                    className={styles.layerButton}
                    onClick={() => select(layer.id)}
                  >
                    <span className={styles.layerName}>
                      {layerObject?.nameRu ?? layer.objectId}
                    </span>
                    <span className={styles.layerState}>
                      {layer.state === 'main' ? ru.editor.inspector.main : ru.editor.inspector.bg}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2 className="fieldLabel">{ru.editor.inspector.selected}</h2>
        {item && object ? (
          <div className={styles.selected}>
            <div className={styles.selectedName}>{object.nameRu}</div>

            <div className="seg" role="group" aria-label={ru.editor.inspector.state}>
              {(['main', 'bg'] as const).map((state) => (
                <button
                  key={state}
                  type="button"
                  className="segButton"
                  aria-pressed={item.state === state}
                  data-state={state}
                  onClick={() => {
                    if (item.state !== state) toggleState();
                  }}
                >
                  {ru.editor.inspector[state]}
                </button>
              ))}
            </div>

            <div className={styles.positionRow}>
              <label className={styles.numberField}>
                <span className="fieldLabel">X</span>
                <input
                  className="field"
                  type="number"
                  data-field="x"
                  value={Math.round(item.x * 10) / 10}
                  onFocus={checkpoint}
                  onChange={(event) => setItemPosition(item.id, Number(event.target.value), item.y)}
                />
              </label>
              <label className={styles.numberField}>
                <span className="fieldLabel">Y</span>
                <input
                  className="field"
                  type="number"
                  data-field="y"
                  value={Math.round(item.y * 10) / 10}
                  onFocus={checkpoint}
                  onChange={(event) => setItemPosition(item.id, item.x, Number(event.target.value))}
                />
              </label>
              <label className={styles.numberField}>
                <span className="fieldLabel">{ru.editor.inspector.rotation}</span>
                <input
                  className="field"
                  type="number"
                  step={1}
                  data-field="rotation"
                  value={Math.round(item.rotation * 10) / 10}
                  onFocus={checkpoint}
                  onChange={(event) => setRotation(item.id, Number(event.target.value))}
                />
              </label>
            </div>

            {rotationWarning ? (
              <div className={styles.warning} role="status">
                {ru.editor.inspector.rotationWarning}
              </div>
            ) : null}

            <div className={styles.layerActions}>
              <button
                type="button"
                className="btn btnIcon"
                title={ru.editor.inspector.front}
                aria-label={ru.editor.inspector.front}
                data-action="layer-front"
                onClick={() => reorderSelected('front')}
              >
                ⤒
              </button>
              <button
                type="button"
                className="btn btnIcon"
                title={ru.editor.inspector.forward}
                aria-label={ru.editor.inspector.forward}
                data-action="layer-forward"
                onClick={() => reorderSelected('forward')}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btnIcon"
                title={ru.editor.inspector.backward}
                aria-label={ru.editor.inspector.backward}
                data-action="layer-backward"
                onClick={() => reorderSelected('backward')}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btnIcon"
                title={ru.editor.inspector.back}
                aria-label={ru.editor.inspector.back}
                data-action="layer-back"
                onClick={() => reorderSelected('back')}
              >
                ⤓
              </button>
            </div>

            <div className={styles.selectedActions}>
              <button
                type="button"
                className="btn"
                data-action="duplicate"
                onClick={duplicateSelected}
              >
                {ru.editor.inspector.duplicate}
              </button>
              <button
                type="button"
                className="btn btnDanger"
                data-action="delete"
                onClick={removeSelected}
              >
                {ru.editor.inspector.delete}
              </button>
            </div>
          </div>
        ) : (
          <p className={styles.empty}>{ru.editor.inspector.empty}</p>
        )}
      </section>
    </div>
  );
}
