import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseCatalog, type Catalog } from '../../src/core/catalog';
import type { LayoutData } from '../../src/core/layout/types';
import type { FragmentPath, SubstrateVariant } from '../../src/core/types';

const projectRoot = process.cwd();
const generated = path.join(projectRoot, 'data', 'generated');

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(generated, file), 'utf8')) as T;
}

export function readSource(file: string): string {
  return readFileSync(path.join(projectRoot, file), 'utf8');
}

export function loadCatalog(): Catalog {
  return parseCatalog(readJson<unknown>('catalog.json'));
}

export function loadFragments(catalog: Catalog): Map<string, FragmentPath[]> {
  const map = new Map<string, FragmentPath[]>();
  for (const object of catalog.objects) {
    for (const variant of object.variants) {
      const file = path.join(generated, variant.file);
      map.set(variant.key, JSON.parse(readFileSync(file, 'utf8')) as FragmentPath[]);
    }
  }
  return map;
}

export function loadSubstrates(): SubstrateVariant[] {
  return [
    readJson<SubstrateVariant>('substrates/confetti.json'),
    readJson<SubstrateVariant>('substrates/diagonal.json'),
  ];
}

export function loadLayoutData(): LayoutData {
  return {
    templates: readJson<{ templates: LayoutData['templates'] }>('templates.json').templates,
    relations: readJson<{ relations: LayoutData['relations'] }>('relations.json').relations,
    stats: readJson<LayoutData['stats']>('stats.json'),
  };
}

export function allowedPathData(catalog: Catalog): Set<string> {
  const allowed = new Set<string>();
  for (const object of catalog.objects) {
    for (const variant of object.variants) {
      const file = path.join(generated, variant.file);
      const fragments = JSON.parse(readFileSync(file, 'utf8')) as FragmentPath[];
      for (const fragment of fragments) allowed.add(fragment.d);
    }
  }
  for (const substrate of loadSubstrates()) {
    for (const format of Object.values(substrate.byFormat)) {
      for (const element of format.elements) {
        if (element.tag === 'path' && element.d) allowed.add(element.d);
      }
    }
  }
  return allowed;
}
