// colour conversions between what fhem devices report (rgb as hex, CIE xy, colour temperature)
// and the hue, saturation and brightness HomeKit works with. hue, saturation and value are
// fractions between 0 and 1 here.

import { looselyEqual } from './loose.ts';

export type Hsv = [h: number | undefined, s: number, v: number];

/** six hex digits for three components from 0 to 255, given one by one or as a list */
export function rgb2hex(r: number | number[], g?: number, b?: number): string {
  if (g === undefined) {
    const rgb = r as [number, number, number];
    return (0x1000000 + rgb[0] * 0x10000 + rgb[1] * 0x100 + rgb[2]).toString(16).substring(1);
  }

  return (0x1000000 + (r as number) * 0x10000 + g * 0x100 + (b as number)).toString(16).substring(1);
}

export function hsv2rgb(h: number, s: number, v: number): string {
  let r = 0.0;
  let g = 0.0;
  let b = 0.0;

  if (looselyEqual(s, 0)) {
    r = v;
    g = v;
    b = v;
  } else {
    let i = Math.floor(h * 6.0);
    const f = h * 6.0 - i;
    const p = v * (1.0 - s);
    const q = v * (1.0 - s * f);
    const t = v * (1.0 - s * (1.0 - f));
    i = i % 6;

    if (i === 0) {
      r = v;
      g = t;
      b = p;
    } else if (i === 1) {
      r = q;
      g = v;
      b = p;
    } else if (i === 2) {
      r = p;
      g = v;
      b = t;
    } else if (i === 3) {
      r = p;
      g = q;
      b = v;
    } else if (i === 4) {
      r = t;
      g = p;
      b = v;
    } else if (i === 5) {
      r = v;
      g = p;
      b = q;
    }
  }

  return rgb2hex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}

/**
 * The colour of a colour temperature in mired, or in kelvin for values above 1000.
 * Calculation from http://www.tannerhelland.com/4435/convert-temperature-rgb-algorithm-code
 */
export function ct2rgb(ct: number | string): string {
  let mired = Number(ct);

  // kelvin -> mired
  if (mired > 1000) {
    mired = 1000000 / mired;
  }

  // adjusted by 1000K
  const temp = 1000000 / mired / 100 + 10;

  let r = 255;
  if (temp > 66) {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
  }
  if (r < 0) {
    r = 0;
  }
  if (r > 255) {
    r = 255;
  }

  // green was calculated here and then always replaced by 255. see docs/KNOWN_BUGS.md, 7.
  const g = 255;

  // blue for temperatures below 5600 K was calculated with a function that does not exist, which
  // ended the conversion with this error. see docs/KNOWN_BUGS.md, 6.
  if (temp < 66) {
    throw new ReferenceError('log is not defined');
  }
  const b = 255;

  return rgb2hex(Math.round(r), Math.round(g), Math.round(b));
}

/** Calculation from http://www.brucelindbloom.com/index.html */
export function xyY2rgb(xValue: number | string, yValue: number | string, YValue: number): string {
  const x = Number(xValue);
  const y = Number(yValue);
  let Y = YValue;

  let r = 0;
  let g = 0;
  let b = 0;

  if (y > 0) {
    let X = (x * Y) / y;
    let Z = ((1 - x - y) * Y) / y;

    if (X > 1 || Y > 1 || Z > 1) {
      const f = Math.max(X, Y, Z);
      X /= f;
      Y /= f;
      Z /= f;
    }

    r = 0.7982 * X + 0.3389 * Y - 0.1371 * Z;
    g = -0.5918 * X + 1.5512 * Y + 0.0406 * Z;
    b = 0.0008 * X + 0.0239 * Y + 0.9753 * Z;

    if (r > 1 || g > 1 || b > 1) {
      const f = Math.max(r, g, b);
      r /= f;
      g /= f;
      b /= f;
    }
  }

  return rgb2hex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
}

/** hue, saturation and value of a colour given as six hex digits, or as three components from 0 to 1 */
export function rgb2hsv(red?: number | string, green?: number, blue?: number): Hsv | undefined {
  if (red === undefined) {
    return undefined;
  }

  let r: number;
  let g: number;
  let b: number;
  if (green === undefined) {
    const str = red as string;
    r = parseInt(str.substring(0, 2), 16) / 255;
    g = parseInt(str.substring(2, 4), 16) / 255;
    b = parseInt(str.substring(4, 6), 16) / 255;
  } else {
    r = red as number;
    g = green;
    b = blue as number;
  }

  const M = Math.max(r, g, b);
  const m = Math.min(r, g, b);
  const c = M - m;

  let h: number | undefined;
  if (c === 0) {
    h = 0;
  } else if (M === r) {
    h = ((360 + 60 * ((g - b) / c)) % 360) / 360;
  } else if (M === g) {
    h = (60 * ((b - r) / c) + 120) / 360;
  } else if (M === b) {
    h = (60 * ((r - g) / c) + 240) / 360;
  }

  const s = M === 0 ? 0 : c / M;
  const v = M;

  return [h, s, v];
}
