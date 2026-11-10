import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCurated } from './curated';
import { buildExamples, writeExamples } from './examples';
import { buildLibrary, writeLibrary } from './library';
import { buildSubstrates, writeSubstrates } from './substrates';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const curated = loadCurated(projectRoot);
const library = buildLibrary(projectRoot, curated);
writeLibrary(projectRoot, library);

const baseSubstrates = buildSubstrates(projectRoot, curated);
const examples = buildExamples(projectRoot, curated, library, baseSubstrates);
writeExamples(projectRoot, examples);
writeSubstrates(projectRoot, examples.substrates);

const variantCount = library.catalog.objects.reduce(
  (sum, object) => sum + object.variants.length,
  0,
);
const aliasCount = library.diagnostics.filter((item) => item.kind === 'alias').length;
const sceneCount = new Set(examples.templates.map((template) => template.sceneId)).size;

console.log(`[ingest] objects: ${library.catalog.objects.length}`);
console.log(`[ingest] variants: ${variantCount} (${aliasCount} aliases)`);
console.log(`[ingest] fragments: ${library.fragments.size}`);
console.log(`[ingest] substrates: ${examples.substrates.map((item) => item.id).join(', ')}`);
console.log(`[ingest] templates: ${examples.templates.length} in ${sceneCount} scenes`);
console.log(`[ingest] relations: ${examples.relations.relations.length}`);
console.log(`[ingest] color permutations: ${examples.stats.colorPermutations.length}`);

for (const template of examples.templates) {
  const items = template.items
    .map((item) => `${item.objectId}:${item.state}/${item.size}@${item.x},${item.y}`)
    .join(' ');
  console.log(`  ${template.id} [${template.substrate}] ${items}`);
}

if (examples.warnings.length > 0) {
  console.log(`[ingest] warnings (${examples.warnings.length}):`);
  for (const warning of examples.warnings.slice(0, 30)) {
    console.log(`  ! ${warning}`);
  }
}

console.log('[ingest] S -> L fits:');
for (const item of library.diagnostics) {
  console.log(
    `  ${item.objectId}.${item.state}: ${item.kind}, ` +
      `scale=${item.scale.toFixed(4)}, rms=${item.rms.toFixed(4)}, ` +
      `matched=${item.matched}/${item.total}`,
  );
}
