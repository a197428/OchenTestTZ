import { layout } from '../../core/layout/layout';
import type { FormatId, Scene } from '../../core/types';
import type { Assets } from '../data/assets';

export type BgMode = 'auto' | 'on' | 'off';

export interface LayoutOptions {
  format?: FormatId;
  seed: number;
  bgMode: BgMode;
}

export function layoutScene(scene: Scene, assets: Assets, options: LayoutOptions): Scene {
  return layout(
    {
      items: scene.items.map((item) => ({ objectId: item.objectId, state: item.state })),
      format: options.format ?? scene.format,
      size: scene.size,
      seed: options.seed,
      backdrop: options.bgMode,
      paletteId: scene.paletteId,
      substrate: scene.substrate,
    },
    assets.catalog,
    assets.layout,
  );
}
