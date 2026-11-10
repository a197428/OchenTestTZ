import catalogJson from '../../../data/generated/catalog.json';
import relationsJson from '../../../data/generated/relations.json';
import statsJson from '../../../data/generated/stats.json';
import confettiJson from '../../../data/generated/substrates/confetti.json';
import diagonalJson from '../../../data/generated/substrates/diagonal.json';
import templatesJson from '../../../data/generated/templates.json';
import { parseCatalog, type Catalog } from '../../core/catalog';
import type { LayoutData } from '../../core/layout/types';
import type { FragmentPath, SubstrateVariant } from '../../core/types';

const fragmentModules = import.meta.glob<{ default: FragmentPath[] }>(
  '../../../data/generated/fragments/*.json',
);

export interface Assets {
  catalog: Catalog;
  fragments: Map<string, FragmentPath[]>;
  substrates: SubstrateVariant[];
  layout: LayoutData;
}

async function loadAssets(): Promise<Assets> {
  const catalog = parseCatalog(catalogJson as unknown);
  const fragments = new Map<string, FragmentPath[]>();

  await Promise.all(
    catalog.objects.flatMap((object) =>
      object.variants.map(async (variant) => {
        const modulePath = `../../../data/generated/fragments/${variant.key}.json`;
        const loader = fragmentModules[modulePath];
        if (!loader) {
          throw new Error(`Fragment module not found: ${variant.key}`);
        }
        const module = await loader();
        fragments.set(variant.key, module.default);
      }),
    ),
  );

  return {
    catalog,
    fragments,
    substrates: [
      confettiJson as unknown as SubstrateVariant,
      diagonalJson as unknown as SubstrateVariant,
    ],
    layout: {
      templates: (templatesJson as unknown as { templates: LayoutData['templates'] }).templates,
      relations: (relationsJson as unknown as { relations: LayoutData['relations'] }).relations,
      stats: statsJson as unknown as LayoutData['stats'],
    },
  };
}

export const assetsPromise = loadAssets();
