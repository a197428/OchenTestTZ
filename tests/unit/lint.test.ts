import { describe, expect, it } from 'vitest';
import { lintExport } from '../../src/core/export/lint';
import { exportScene } from '../../src/core/export/svg';
import { createScene, addItem } from '../../src/core/scene';
import { allowedPathData, loadCatalog, loadFragments, loadSubstrates } from '../helpers/assets';

const catalog = loadCatalog();
const fragments = loadFragments(catalog);
const substrates = loadSubstrates();
const allowedD = allowedPathData(catalog);

function validSvg(): string {
  let scene = createScene('square', 'purple', 'confetti');
  scene = addItem(scene, {
    id: 'book',
    objectId: 'book',
    state: 'main',
    x: 0,
    y: 0,
    rotation: 0,
  });
  return exportScene(scene, { catalog, fragments, substrates });
}

describe('export lint', () => {
  it('accepts a valid export', () => {
    const result = lintExport(validSvg(), { width: 1000, height: 1000, allowedD });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects raster and style elements', () => {
    const withImage = validSvg().replace(
      '<g id="ic1-scene">',
      '<g id="ic1-scene"><image href="x.png"/>',
    );
    expect(lintExport(withImage, { width: 1000, height: 1000 }).ok).toBe(false);
    const withStyle = validSvg().replace(
      '<g id="ic1-scene">',
      '<g id="ic1-scene"><style>path{fill:red}</style>',
    );
    expect(lintExport(withStyle, { width: 1000, height: 1000 }).ok).toBe(false);
  });

  it('rejects path data that is not in the catalog', () => {
    const changed = validSvg().replace(/d="M[^"]+"/, 'd="M0 0L1 1"');
    const result = lintExport(changed, { width: 1000, height: 1000, allowedD });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('byte-identical'))).toBe(true);
  });

  it('rejects duplicate ids and wrong dimensions', () => {
    const duplicate = validSvg().replace(
      '<g id="ic1-scene">',
      '<g id="ic1-scene"><g id="ic1-background"></g>',
    );
    expect(lintExport(duplicate, { width: 1000, height: 1000 }).ok).toBe(false);
    expect(lintExport(validSvg(), { width: 1200, height: 630 }).ok).toBe(false);
  });

  it('rejects non-hex colors and external references', () => {
    const gradient = validSvg().replace('fill="#D7CDF5"', 'fill="url(#paint0)"');
    expect(lintExport(gradient, { width: 1000, height: 1000 }).ok).toBe(false);
  });
});
