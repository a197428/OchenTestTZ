import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { objectById, variantFor } from '../../core/catalog';
import {
  applyMatrix,
  bboxOfPoints,
  instancePlacementMatrix,
  matrixToSvg,
  transformPoints,
} from '../../core/geometry';
import { FORMATS } from '../../core/layout/formats';
import { buildSceneRender } from '../../core/render';
import type { Instance } from '../../core/types';
import type { Assets } from '../data/assets';
import { ru } from '../i18n';
import { useEditor } from '../store/editor';
import styles from './SceneCanvas.module.css';

interface Props {
  assets: Assets;
}

interface DragState {
  id: string;
  startClientX: number;
  startClientY: number;
  itemX: number;
  itemY: number;
}

interface RotateState {
  id: string;
  centerX: number;
  centerY: number;
  startAngle: number;
  startRotation: number;
}

interface PanState {
  startClientX: number;
  startClientY: number;
  panX: number;
  panY: number;
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

export function SceneCanvas({ assets }: Props) {
  const scene = useEditor((state) => state.scene);
  const selectedId = useEditor((state) => state.selectedId);
  const viewport = useEditor((state) => state.viewport);
  const select = useEditor((state) => state.select);
  const checkpoint = useEditor((state) => state.checkpoint);
  const setItemPosition = useEditor((state) => state.setItemPosition);
  const setRotation = useEditor((state) => state.setRotation);
  const setViewport = useEditor((state) => state.setViewport);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rotateRef = useRef<RotateState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const spaceRef = useRef(false);
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);

  const frame = FORMATS[scene.format];
  const width = frame.width;
  const height = frame.height;
  const zoom = viewport.zoom;

  const render = useMemo(
    () =>
      buildSceneRender(scene, {
        catalog: assets.catalog,
        fragments: assets.fragments,
        substrates: assets.substrates,
      }),
    [scene, assets],
  );

  const selected = scene.items.find((item) => item.id === selectedId) ?? null;

  const selection = useMemo(() => {
    if (!selected) return null;
    const object = objectById(assets.catalog, selected.objectId);
    const variant = variantFor(object, selected.state, scene.size);
    const placement = instancePlacementMatrix(scene, selected, variant, scene.format);
    const hull = transformPoints(placement, variant.hull);
    const box = bboxOfPoints(hull);
    const center = applyMatrix(placement, variant.bbox.w / 2, variant.bbox.h / 2);
    const handle = { x: center[0], y: box[1] - 30 / zoom };
    return { item: selected, hull, box, center: { x: center[0], y: center[1] }, handle };
  }, [selected, assets.catalog, scene, zoom]);

  const toScene = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const element = containerRef.current;
      if (!element) return { x: 0, y: 0 };
      const rect = element.getBoundingClientRect();
      const originX = rect.width / 2 - (width * zoom) / 2 + viewport.panX;
      const originY = rect.height / 2 - (height * zoom) / 2 + viewport.panY;
      return {
        x: (clientX - rect.left - originX) / zoom,
        y: (clientY - rect.top - originY) / zoom,
      };
    },
    [width, height, zoom, viewport.panX, viewport.panY],
  );

  const fit = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const fitZoom = Math.min(rect.width / width, rect.height / height) * 0.9;
    setViewport({ zoom: fitZoom, panX: 0, panY: 0 });
  }, [width, height, setViewport]);

  useLayoutEffect(() => {
    fit();
  }, [scene.format, fit]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const state = useEditor.getState();
      const current = state.viewport;
      const currentFrame = FORMATS[state.scene.format];
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const originX = rect.width / 2 - (currentFrame.width * current.zoom) / 2 + current.panX;
      const originY = rect.height / 2 - (currentFrame.height * current.zoom) / 2 + current.panY;
      const worldX = (mouseX - originX) / current.zoom;
      const worldY = (mouseY - originY) / current.zoom;
      const factor = event.deltaY < 0 ? 1.12 : 0.89;
      const nextZoom = Math.min(5, Math.max(0.2, current.zoom * factor));
      state.setViewport({
        zoom: nextZoom,
        panX: mouseX - worldX * nextZoom - rect.width / 2 + (currentFrame.width * nextZoom) / 2,
        panY: mouseY - worldY * nextZoom - rect.height / 2 + (currentFrame.height * nextZoom) / 2,
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const isEditable = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    const down = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || isEditable(event.target)) return;
      event.preventDefault();
      spaceRef.current = true;
      setSpace(true);
    };
    const up = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return;
      spaceRef.current = false;
      setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const endGesture = (): void => {
    dragRef.current = null;
    rotateRef.current = null;
    panRef.current = null;
    setDragging(false);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button === 1 || (event.button === 0 && spaceRef.current)) {
      event.preventDefault();
      panRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        panX: viewport.panX,
        panY: viewport.panY,
      };
      containerRef.current?.setPointerCapture(event.pointerId);
      setDragging(true);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current) {
      const drag = dragRef.current;
      setItemPosition(
        drag.id,
        drag.itemX + (event.clientX - drag.startClientX) / zoom,
        drag.itemY + (event.clientY - drag.startClientY) / zoom,
      );
      return;
    }
    if (rotateRef.current) {
      const rotate = rotateRef.current;
      const point = toScene(event.clientX, event.clientY);
      const angle =
        (Math.atan2(point.y - rotate.centerY, point.x - rotate.centerX) * 180) / Math.PI;
      let value = rotate.startRotation + (angle - rotate.startAngle);
      if (event.shiftKey) value = Math.round(value / 15) * 15;
      setRotation(rotate.id, Math.round(value * 10) / 10);
      return;
    }
    if (panRef.current) {
      const pan = panRef.current;
      setViewport({
        panX: pan.panX + (event.clientX - pan.startClientX),
        panY: pan.panY + (event.clientY - pan.startClientY),
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (containerRef.current?.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
    endGesture();
  };

  const beginDrag = (item: Instance, event: ReactPointerEvent<SVGGElement>): void => {
    if (event.button !== 0 || spaceRef.current) return;
    event.stopPropagation();
    select(item.id);
    checkpoint();
    dragRef.current = {
      id: item.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      itemX: item.x,
      itemY: item.y,
    };
    containerRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const beginRotate = (event: ReactPointerEvent<SVGCircleElement>): void => {
    if (!selection) return;
    event.stopPropagation();
    checkpoint();
    const point = toScene(event.clientX, event.clientY);
    rotateRef.current = {
      id: selection.item.id,
      centerX: selection.center.x,
      centerY: selection.center.y,
      startAngle:
        (Math.atan2(point.y - selection.center.y, point.x - selection.center.x) * 180) / Math.PI,
      startRotation: selection.item.rotation,
    };
    containerRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const zoomBy = (factor: number): void => {
    setViewport({ zoom: Math.min(5, Math.max(0.2, zoom * factor)) });
  };

  return (
    <div
      ref={containerRef}
      className={styles.viewport}
      data-testid="canvas"
      data-scene-format={scene.format}
      data-scene-size={scene.size}
      data-scene-palette={scene.paletteId}
      data-scene-substrate={scene.substrate}
      data-scene-scale={scene.scale}
      style={{ cursor: space ? 'grab' : dragging ? 'grabbing' : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg
        className={styles.stage}
        data-testid="scene-svg"
        width={width * zoom}
        height={height * zoom}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: width * zoom,
          height: height * zoom,
          transform: `translate(-50%, -50%) translate(${viewport.panX}px, ${viewport.panY}px)`,
        }}
      >
        <defs>
          <clipPath id="editor-frame">
            <rect width={width} height={height} />
          </clipPath>
        </defs>
        <g clipPath="url(#editor-frame)">
          <rect
            width={width}
            height={height}
            fill={render.background}
            onPointerDown={(event) => {
              if (spaceRef.current) return;
              event.stopPropagation();
              select(null);
            }}
          />
          {render.substrate ? (
            <g
              transform={matrixToSvg(render.substrate.matrix)}
              pointerEvents="none"
              data-substrate={render.substrate.id}
            >
              {render.substrate.elements.map((element, index) => {
                if (element.tag === 'rect') {
                  return (
                    <rect
                      key={index}
                      x={element.x}
                      y={element.y}
                      width={element.width}
                      height={element.height}
                      fill={element.fill ?? 'none'}
                      {...reactAttrs(element.attrs)}
                    />
                  );
                }
                if (element.tag === 'line') {
                  return (
                    <line
                      key={index}
                      x1={element.x1}
                      y1={element.y1}
                      x2={element.x2}
                      y2={element.y2}
                      stroke={element.stroke ?? 'none'}
                      {...reactAttrs(element.attrs)}
                    />
                  );
                }
                return (
                  <path
                    key={index}
                    d={element.d}
                    fill={element.fill ?? 'none'}
                    stroke={element.stroke}
                    {...reactAttrs(element.attrs)}
                  />
                );
              })}
            </g>
          ) : null}

          <g>
            {render.objects.map((object) => {
              const item = scene.items.find((candidate) => candidate.id === object.instanceId);
              return (
                <g
                  key={object.instanceId}
                  transform={matrixToSvg(object.matrix)}
                  data-object-id={object.objectId}
                  data-instance-id={object.instanceId}
                  data-state={object.state}
                  style={{ cursor: space ? 'grab' : 'move' }}
                  onPointerDown={(event) => {
                    if (item) beginDrag(item, event);
                  }}
                >
                  {object.paths.map((path, index) => (
                    <path
                      key={index}
                      d={path.d}
                      fill={path.fill ?? 'none'}
                      stroke={path.stroke}
                      {...reactAttrs(path.attrs)}
                    />
                  ))}
                </g>
              );
            })}
          </g>
        </g>

        {selection ? (
          <g pointerEvents="none">
            <polygon
              className={styles.selection}
              points={selection.hull.map(([x, y]) => `${x},${y}`).join(' ')}
              strokeWidth={2 / zoom}
              strokeDasharray={`${7 / zoom} ${5 / zoom}`}
            />
            <line
              x1={selection.center.x}
              y1={selection.box[1]}
              x2={selection.handle.x}
              y2={selection.handle.y}
              stroke="var(--accent)"
              strokeWidth={1.5 / zoom}
            />
          </g>
        ) : null}
        {selection ? (
          <circle
            cx={selection.handle.x}
            cy={selection.handle.y}
            r={7 / zoom}
            fill="var(--accent)"
            stroke="#0f1013"
            strokeWidth={2 / zoom}
            style={{ cursor: 'crosshair' }}
            onPointerDown={beginRotate}
          />
        ) : null}
      </svg>

      {scene.items.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>{ru.editor.canvas.emptyTitle}</div>
          <div className={styles.emptyHint}>{ru.editor.canvas.emptyHint}</div>
        </div>
      ) : null}

      {selection && Math.abs(selection.item.rotation % 360) > 0.001 ? (
        <div className={styles.warning} role="status">
          {ru.editor.inspector.rotationWarning}
        </div>
      ) : null}

      <div className={styles.zoomControls}>
        <button
          type="button"
          className="btn btnIcon"
          onClick={() => zoomBy(1.2)}
          aria-label={ru.editor.canvas.zoomIn}
        >
          +
        </button>
        <button
          type="button"
          className="btn btnIcon"
          onClick={() => zoomBy(0.83)}
          aria-label={ru.editor.canvas.zoomOut}
        >
          −
        </button>
        <button
          type="button"
          className="btn btnIcon"
          onClick={fit}
          title={ru.editor.canvas.fit}
          aria-label={ru.editor.canvas.fit}
        >
          ⛶
        </button>
      </div>
    </div>
  );
}
