import { describe, expect, it } from 'vitest';
import { BUILTIN_PALETTES, parsePalette, validatePalette } from '../../src/core/palette';

describe('built-in palettes', () => {
  it('has the three schemes with all eight slots', () => {
    expect(BUILTIN_PALETTES.map((palette) => palette.id)).toEqual(['purple', 'orange', 'teal']);
    for (const palette of BUILTIN_PALETTES) {
      expect(Object.keys(palette.slots)).toHaveLength(8);
      expect(validatePalette(palette)).toEqual([]);
    }
  });
});

describe('palette parsing', () => {
  it('accepts a full eight-slot JSON object', () => {
    const input = JSON.stringify({
      id: 'test',
      name: 'Test',
      slots: BUILTIN_PALETTES[0]!.slots,
    });
    const { palette } = parsePalette(input);
    expect(palette.id).toBe('test');
    expect(palette.slots['bg-light']).toBe('#D7CDF5');
  });

  it('accepts a bg/obj JSON object and orders backgrounds by lightness', () => {
    const { palette } = parsePalette(
      JSON.stringify({
        bg: ['#7864D7', '#D7CDF5', '#AA9BF0'],
        obj: ['#F9ECB0', '#F9A3AA', '#FFE3E1'],
      }),
      { id: 'split' },
    );
    expect(palette.slots['bg-dark']).toBe('#7864D7');
    expect(palette.slots['bg-mid']).toBe('#AA9BF0');
    expect(palette.slots['bg-light']).toBe('#D7CDF5');
    expect(palette.slots['obj-1']).toBe('#F9ECB0');
  });

  it('auto-assigns six colors by hue cluster and lightness', () => {
    const { palette } = parsePalette('#F9ECB0, #AA9BF0, #F9A3AA, #7864D7, #FFE3E1, #D7CDF5');
    expect(palette.slots['bg-light']).toBe('#D7CDF5');
    expect(palette.slots['bg-mid']).toBe('#AA9BF0');
    expect(palette.slots['bg-dark']).toBe('#7864D7');
    expect(palette.slots['obj-1']).toBe('#F9ECB0');
    expect(palette.slots['obj-2']).toBe('#F9A3AA');
    expect(palette.slots['obj-3']).toBe('#FFE3E1');
  });

  it('accepts CSS variables and eight colors in slot order', () => {
    const css = `
      --bg-light: #D7CDF5;
      --bg-mid: #AA9BF0;
      --bg-dark: #7864D7;
      --obj-1: #F9ECB0;
      --obj-2: #F9A3AA;
      --obj-3: #FFE3E1;
      --ink: #181817;
      --white: #FFFFFF;
    `;
    const { palette } = parsePalette(css);
    expect(palette.slots['bg-dark']).toBe('#7864D7');
    expect(palette.slots['white']).toBe('#FFFFFF');
  });

  it('normalizes white and short hex values', () => {
    const { palette } = parsePalette('#d7cdf5 #aa9bf0 #7864d7 #f9ecb0 #f9a3aa #ffe3e1');
    expect(palette.slots['bg-light']).toBe('#D7CDF5');
    expect(palette.slots['white']).toBe('#FFFFFF');
  });

  it('rejects an invalid number of colors', () => {
    expect(() => parsePalette('#000 #fff')).toThrow(/Expected 6 or 8 colors/);
  });

  it('warns when ink contrast against the background is low', () => {
    const { warnings } = parsePalette(
      JSON.stringify({
        bg: ['#F5F5F5', '#EEEEEE', '#E8E8E8'],
        obj: ['#F9ECB0', '#80DADA', '#BEEBEB'],
        ink: '#FAFAFA',
      }),
    );
    expect(warnings.some((warning) => warning.includes('contrast'))).toBe(true);
  });
});
