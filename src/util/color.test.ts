import { describe, expect, it } from 'vitest';
import { ct2rgb, hsv2rgb, rgb2hex, rgb2hsv, xyY2rgb } from './color.ts';

describe('colour conversions', () => {
  it('convert hue, saturation and value to rgb and back', () => {
    for (const hex of ['ff0000', '00ff00', '0000ff', 'ffff00', '336699', '808080', '000000']) {
      const [h, s, v] = rgb2hsv(hex) ?? [];

      expect(hsv2rgb(h ?? 0, s ?? 0, v ?? 0)).toBe(hex);
    }
  });

  it('take a saturation of 0 as text for no colour', () => {
    expect(hsv2rgb(0.5, '0' as unknown as number, 0.5)).toBe('808080');
  });

  it('take xy coordinates as text', () => {
    expect(xyY2rgb('0.7', '0.3', 1)).toBe(xyY2rgb(0.7, 0.3, 1));
    expect(xyY2rgb('x', 'y', 1)).toBe('000000');
  });

  it('take a colour temperature in kelvin or mired, as number or text', () => {
    expect(ct2rgb(6500)).toBe(ct2rgb('6500'));
    expect(ct2rgb(1000000 / 6500)).toBe(ct2rgb(6500));
    expect(ct2rgb('warm')).toBe('ffffff');
  });

  it('format a list of components like three single ones', () => {
    expect(rgb2hex([18, 52, 86])).toBe(rgb2hex(18, 52, 86));
    expect(rgb2hex(18, 52, 86)).toBe('123456');
  });
});
