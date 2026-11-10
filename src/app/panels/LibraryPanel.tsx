import { useMemo, useState } from 'react';
import { variantFor, type CatalogObject } from '../../core/catalog';
import { fallbackIntent } from '../../core/intent/fallback';
import { parseIntent, validateIntent, type ComposeIntent } from '../../core/intent/schema';
import { resolveQuery, searchObjects, type SearchHit } from '../../core/intent/search';
import { matrixToSvg } from '../../core/geometry';
import { layout } from '../../core/layout/layout';
import type { LayoutItemRequest } from '../../core/layout/types';
import { FORMATS } from '../../core/layout/formats';
import { recolorFragment } from '../../core/recolor';
import type { ObjectId, ObjectState } from '../../core/types';
import type { Assets } from '../data/assets';
import { ru } from '../i18n';
import { useEditor } from '../store/editor';
import styles from './LibraryPanel.module.css';

interface Props {
  assets: Assets;
}

interface MeaningResult {
  intent: ComposeIntent;
  usedFallback: boolean;
}

export function LibraryPanel({ assets }: Props) {
  const [tab, setTab] = useState<'meaning' | 'names'>('meaning');
  const [mode, setMode] = useState<ObjectState>('main');
  const [meaning, setMeaning] = useState('');
  const [meaningLoading, setMeaningLoading] = useState(false);
  const [meaningResult, setMeaningResult] = useState<MeaningResult | null>(null);
  const [meaningError, setMeaningError] = useState<string | null>(null);
  const [names, setNames] = useState('');
  const [chips, setChips] = useState<ObjectId[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [unknownSuggestions, setUnknownSuggestions] = useState<SearchHit[]>([]);
  const scene = useEditor((state) => state.scene);
  const addObject = useEditor((state) => state.addObject);
  const layoutSeed = useEditor((state) => state.layoutSeed);
  const bumpLayoutSeed = useEditor((state) => state.bumpLayoutSeed);
  const bgMode = useEditor((state) => state.bgMode);
  const applyLayout = useEditor((state) => state.applyLayout);

  const activeToken =
    names
      .split(/[,;\n]/)
      .pop()
      ?.trim() ?? '';
  const suggestions = useMemo(
    () =>
      activeToken.length >= 2
        ? searchObjects(activeToken, assets.catalog, 6).filter(
            (hit) => !chips.includes(hit.object.id),
          )
        : [],
    [activeToken, assets.catalog, chips],
  );

  const compose = (items: LayoutItemRequest[]): void => {
    const next = layout(
      {
        items,
        format: scene.format,
        size: scene.size,
        seed: layoutSeed,
        backdrop: bgMode,
        paletteId: scene.paletteId,
        substrate: scene.substrate,
      },
      assets.catalog,
      assets.layout,
    );
    applyLayout(next);
    bumpLayoutSeed();
  };

  const addObjectToCanvas = (object: CatalogObject): void => {
    const variant = variantFor(object, mode, scene.size);
    const frame = FORMATS[scene.format];
    const offset = ((scene.items.length % 5) - 2) * 22;
    const x = (frame.width - variant.bbox.w) / 2 + offset;
    const y = (frame.height - variant.bbox.h) / 2 + offset;
    addObject(object.id, mode, x, y);
  };

  const composeMeaning = async (): Promise<void> => {
    const text = meaning.trim();
    if (!text || meaningLoading) return;
    setMeaningLoading(true);
    setMeaningError(null);
    setMeaningResult(null);
    let intent: ComposeIntent;
    let usedFallback: boolean;
    try {
      const response = await fetch('/api/compose-intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, locale: 'ru' }),
      });
      if (!response.ok) throw new Error('compose-intent failed');
      usedFallback = response.headers.get('x-intent-source') === 'fallback';
      const parsed = parseIntent(await response.json());
      const validation = validateIntent(parsed, assets.catalog);
      if (!validation.ok) throw new Error(validation.errors.join('; '));
      intent = parsed;
    } catch {
      intent = fallbackIntent(text, assets.catalog);
      usedFallback = true;
    }

    try {
      compose(
        intent.picks.map((pick) => ({
          objectId: pick.objectId as ObjectId,
          state: pick.state,
        })),
      );
      setMeaningResult({ intent, usedFallback });
    } catch (cause) {
      setMeaningError(cause instanceof Error ? cause.message : ru.editor.meaning.error);
    } finally {
      setMeaningLoading(false);
    }
  };

  const addChip = (objectId: ObjectId): void => {
    setChips((current) => (current.includes(objectId) ? current : [...current, objectId]));
    setNames('');
    setUnknown([]);
    setUnknownSuggestions([]);
  };

  const submitNames = (): void => {
    const query = names.trim();
    if (!query) return;
    const result = resolveQuery(query, assets.catalog);
    if (result.matched.length > 0) {
      setChips((current) => {
        const next = [...current];
        for (const hit of result.matched) {
          if (!next.includes(hit.object.id)) next.push(hit.object.id);
        }
        return next;
      });
      setNames('');
    }
    setUnknown(result.unknown);
    setUnknownSuggestions(result.suggestions);
  };

  const composeNames = (): void => {
    if (chips.length === 0) return;
    compose(chips.map((objectId) => ({ objectId, state: 'main' })));
  };

  const fitLabel = meaningResult
    ? meaningResult.intent.fit === 'good'
      ? ru.editor.meaning.fitGood
      : meaningResult.intent.fit === 'approximate'
        ? ru.editor.meaning.fitApproximate
        : ru.editor.meaning.fitWeak
    : '';
  const fitNote = meaningResult
    ? meaningResult.intent.note ||
      (meaningResult.intent.fit === 'good'
        ? ru.editor.meaning.noteGood
        : meaningResult.intent.fit === 'approximate'
          ? ru.editor.meaning.noteApproximate
          : ru.editor.meaning.noteWeak)
    : '';

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
          <div className={styles.inputBlock}>
            <label>
              <span className="fieldLabel">{ru.editor.meaning.title}</span>
              <input
                className="field"
                value={meaning}
                onChange={(event) => setMeaning(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void composeMeaning();
                  }
                }}
                placeholder={ru.editor.meaning.placeholder}
                data-testid="meaning-input"
                disabled={meaningLoading}
              />
            </label>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() => void composeMeaning()}
              disabled={!meaning.trim() || meaningLoading}
              data-action="compose-meaning"
            >
              {meaningLoading ? ru.editor.meaning.loading : ru.editor.meaning.submit}
            </button>
            <span className={styles.note}>{ru.editor.meaning.note}</span>

            {meaningError ? (
              <div className={styles.error} role="alert">
                {meaningError}
              </div>
            ) : null}

            {meaningResult ? (
              <div
                className={styles.result}
                data-testid="meaning-result"
                data-fit={meaningResult.intent.fit}
              >
                <div className={styles.fitRow}>
                  <span>{ru.editor.meaning.fit}</span>
                  <span className={styles.fitBadge} data-fit={meaningResult.intent.fit}>
                    {fitLabel}
                  </span>
                </div>
                <p className={styles.resultNote}>{fitNote}</p>
                {meaningResult.usedFallback ? (
                  <p className={styles.fallbackNote}>{ru.editor.meaning.fallback}</p>
                ) : null}
                <div className="fieldLabel">{ru.editor.meaning.picks}</div>
                <ul className={styles.pickList}>
                  {meaningResult.intent.picks.map((pick) => {
                    const object = assets.catalog.objects.find(
                      (candidate) => candidate.id === pick.objectId,
                    );
                    return (
                      <li key={pick.objectId} className={styles.pick}>
                        <span>{object?.nameRu ?? pick.objectId}</span>
                        <span className={styles.pickReason}>{pick.reason}</span>
                      </li>
                    );
                  })}
                </ul>
                {meaningResult.intent.concepts.length > 0 ? (
                  <div className={styles.concepts}>
                    {meaningResult.intent.concepts.map((concept) => (
                      <span key={concept} className={styles.concept}>
                        {concept}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.inputBlock}>
            <label>
              <span className="fieldLabel">{ru.editor.names.title}</span>
              <input
                className="field"
                value={names}
                onChange={(event) => {
                  setNames(event.target.value);
                  setUnknown([]);
                  setUnknownSuggestions([]);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitNames();
                  }
                }}
                placeholder={ru.editor.names.placeholder}
                data-testid="names-input"
              />
            </label>
            <span className={styles.note}>{ru.editor.names.note}</span>

            {suggestions.length > 0 ? (
              <div className={styles.suggestions}>
                {suggestions.map((hit) => (
                  <button
                    key={hit.object.id}
                    type="button"
                    className={styles.suggestion}
                    data-suggestion={hit.object.id}
                    onClick={() => addChip(hit.object.id)}
                  >
                    {hit.object.nameRu}
                  </button>
                ))}
              </div>
            ) : null}

            {unknown.length > 0 ? (
              <div className={styles.unknown} role="status">
                <strong>{ru.editor.names.unknown}:</strong> {unknown.join(', ')}
                {unknownSuggestions.length > 0 ? (
                  <div className={styles.suggestions}>
                    <span className={styles.suggestionLabel}>{ru.editor.names.suggestions}:</span>
                    {unknownSuggestions.map((hit) => (
                      <button
                        key={hit.object.id}
                        type="button"
                        className={styles.suggestion}
                        data-suggestion={hit.object.id}
                        onClick={() => addChip(hit.object.id)}
                      >
                        {hit.object.nameRu}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {chips.length > 0 ? (
              <>
                <div className="fieldLabel">{ru.editor.names.chips}</div>
                <div className={styles.chips}>
                  {chips.map((objectId) => {
                    const object = assets.catalog.objects.find(
                      (candidate) => candidate.id === objectId,
                    );
                    return (
                      <span key={objectId} className={styles.chip} data-chip={objectId}>
                        {object?.nameRu ?? objectId}
                        <button
                          type="button"
                          className={styles.chipRemove}
                          aria-label={`${ru.editor.names.remove}: ${object?.nameRu ?? objectId}`}
                          onClick={() =>
                            setChips((current) => current.filter((id) => id !== objectId))
                          }
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </>
            ) : null}

            <button
              type="button"
              className="btn btnPrimary"
              onClick={composeNames}
              disabled={chips.length === 0}
              data-action="compose-names"
            >
              {ru.editor.names.compose}
            </button>
          </div>
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
            onClick={() => addObjectToCanvas(object)}
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
              {...reactAttrs(fragment.attrs)}
            />
          );
        })}
      </g>
    </svg>
  );
}

function reactAttrs(attrs?: Record<string, string>): Record<string, string> {
  if (!attrs) return {};
  return Object.fromEntries(
    Object.entries(attrs).map(([name, value]) => [
      name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}
