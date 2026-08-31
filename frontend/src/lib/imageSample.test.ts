import { describe, expect, test } from 'vitest';
import { displayToPixel, fitContain, pixelAt } from './imageSample';

describe('fitContain', () => {
  test('fits a wide image by width', () => {
    expect(fitContain(400, 200, 200, 200)).toEqual({ width: 200, height: 100 });
  });
  test('fits a tall image by height', () => {
    expect(fitContain(200, 400, 200, 200)).toEqual({ width: 100, height: 200 });
  });
  test('does not upscale beyond the box', () => {
    expect(fitContain(50, 50, 200, 200)).toEqual({ width: 50, height: 50 });
  });
});

describe('displayToPixel', () => {
  const display = { width: 200, height: 100 };
  const image = { width: 400, height: 200 };
  test('scales display coords up to image pixels', () => {
    expect(displayToPixel(100, 50, display, image)).toEqual({ x: 200, y: 100 });
  });
  test('clamps out-of-range points inside the image', () => {
    expect(displayToPixel(-5, -5, display, image)).toEqual({ x: 0, y: 0 });
    expect(displayToPixel(999, 999, display, image)).toEqual({ x: 399, y: 199 });
  });
});

describe('pixelAt', () => {
  test('reads RGB from an RGBA buffer', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(pixelAt(data, 2, 0, 0)).toEqual([255, 0, 0]);
    expect(pixelAt(data, 2, 1, 0)).toEqual([0, 255, 0]);
  });
});
