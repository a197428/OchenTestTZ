import { describe, expect, it } from 'vitest';
import { FORMATS, FORMAT_IDS } from '../../src/core/layout/formats';
import { BG_SLOTS, OBJ_SLOTS, SLOTS } from '../../src/core/slots';

describe('project scaffold', () => {
  it('defines the three required formats', () => {
    expect(FORMAT_IDS).toHaveLength(3);
    expect(FORMATS.square).toMatchObject({ width: 1000, height: 1000 });
    expect(FORMATS.wide).toMatchObject({ width: 1200, height: 630 });
    expect(FORMATS.tall).toMatchObject({ width: 800, height: 1200 });
  });

  it('defines all eight color slots', () => {
    expect(SLOTS).toHaveLength(8);
    expect(BG_SLOTS).toHaveLength(3);
    expect(OBJ_SLOTS).toHaveLength(3);
  });
});
