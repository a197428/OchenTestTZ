import type { Catalog } from '../catalog';
import type { Scene } from '../types';
import { generateLayout } from './generic';
import { mulberry32 } from './random';
import { layoutFromTemplate, selectTemplate } from './templates';
import type { LayoutData, LayoutRequest } from './types';

export function layout(request: LayoutRequest, catalog: Catalog, data: LayoutData): Scene {
  const template = selectTemplate(request, data.templates, mulberry32(request.seed >>> 0));
  if (template) {
    return layoutFromTemplate(request, template);
  }
  return generateLayout(request, catalog, data);
}

export type {
  LayoutData,
  LayoutRequest,
  LayoutItemRequest,
  TemplateData,
  TemplateItemData,
  RelationData,
  FormatStatsData,
  StatsData,
} from './types';
