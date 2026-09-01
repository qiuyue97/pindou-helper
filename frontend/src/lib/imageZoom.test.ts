import { describe, expect, test } from 'vitest';
import {
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  applyPinch,
  clampScale,
  panBy,
  pinchOf,
  zoomBy,
} from './imageZoom';

describe('clampScale', () => {
  test('keeps the scale inside the usable range', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(999)).toBe(MAX_SCALE);
    expect(clampScale(3)).toBe(3);
  });
});

describe('zoomBy', () => {
  test('scales about the image centre, leaving the pan alone', () => {
    // The CSS origin is the image's own centre, so zooming must not touch x/y —
    // doing so is what made the cursor-anchored version drift.
    expect(zoomBy({ scale: 2, x: -30, y: 15 }, 1.5)).toEqual({ scale: 3, x: -30, y: 15 });
  });

  test('zooming in raises the scale', () => {
    expect(zoomBy(IDENTITY, 1.4).scale).toBeCloseTo(1.4);
  });

  test('never goes below 1:1, and drops the pan when it gets back there', () => {
    const zoomedAndPanned = { scale: 1.2, x: -80, y: -60 };
    // At 1:1 the image fits again; keeping the old offset would leave it
    // sitting off to one side with blank space beside it.
    expect(zoomBy(zoomedAndPanned, 0.1)).toEqual(IDENTITY);
  });

  test('stops at the maximum instead of running away', () => {
    let t = IDENTITY;
    for (let i = 0; i < 50; i += 1) t = zoomBy(t, 1.4);
    expect(t.scale).toBe(MAX_SCALE);
  });
});

describe('panBy', () => {
  test('moves the image when zoomed in', () => {
    expect(panBy({ scale: 2, x: 0, y: 0 }, 10, -5)).toEqual({ scale: 2, x: 10, y: -5 });
  });

  test('does nothing at 1:1, where the image already fits', () => {
    expect(panBy(IDENTITY, 30, 30)).toEqual(IDENTITY);
  });
});

describe('pinchOf', () => {
  test('measures the spread and the midpoint', () => {
    const p = pinchOf({ x: 0, y: 0 }, { x: 6, y: 8 });
    expect(p.dist).toBe(10);
    expect(p.mid).toEqual({ x: 3, y: 4 });
  });
});

describe('applyPinch', () => {
  test('spreading the fingers zooms in by the same ratio', () => {
    const prev = pinchOf({ x: 90, y: 50 }, { x: 110, y: 50 });
    const next = pinchOf({ x: 80, y: 50 }, { x: 120, y: 50 }); // 距离翻倍
    expect(applyPinch(IDENTITY, prev, next).scale).toBeCloseTo(2);
  });

  test('bringing them together zooms out', () => {
    const start = { scale: 4, x: -100, y: -60 };
    const prev = pinchOf({ x: 80, y: 50 }, { x: 120, y: 50 });
    const next = pinchOf({ x: 90, y: 50 }, { x: 110, y: 50 }); // 距离减半
    expect(applyPinch(start, prev, next).scale).toBeCloseTo(2);
  });

  test('a pinch that only spreads does not shift the image', () => {
    const start = { scale: 2, x: -30, y: -20 };
    const prev = pinchOf({ x: 90, y: 40 }, { x: 110, y: 60 });
    const next = pinchOf({ x: 80, y: 30 }, { x: 120, y: 70 }); // 中点不变
    const out = applyPinch(start, prev, next);
    expect(out.x).toBeCloseTo(start.x);
    expect(out.y).toBeCloseTo(start.y);
  });

  test('sliding the whole gesture pans by the midpoint travel', () => {
    const start = { scale: 2, x: 0, y: 0 };
    const prev = pinchOf({ x: 90, y: 50 }, { x: 110, y: 50 });
    // 距离不变，整体右移 20
    const next = pinchOf({ x: 110, y: 50 }, { x: 130, y: 50 });
    const out = applyPinch(start, prev, next);
    expect(out.scale).toBeCloseTo(2);
    expect(out.x).toBeCloseTo(20);
    expect(out.y).toBeCloseTo(0);
  });

  test('two fingers on the same spot cannot divide by zero', () => {
    const degenerate = pinchOf({ x: 50, y: 50 }, { x: 50, y: 50 });
    const next = pinchOf({ x: 40, y: 50 }, { x: 60, y: 50 });
    expect(applyPinch(IDENTITY, degenerate, next)).toEqual(IDENTITY);
  });

  test('pinching all the way out lands back at a centred 1:1', () => {
    const start = { scale: 3, x: -200, y: -150 };
    const prev = pinchOf({ x: 0, y: 0 }, { x: 200, y: 0 });
    const next = pinchOf({ x: 99, y: 0 }, { x: 101, y: 0 });
    expect(applyPinch(start, prev, next)).toEqual(IDENTITY);
  });

  test('successive steps compose to the overall spread', () => {
    // 真实手势是一连串小 move，不是一步到位。两根手指从相距 40 张到 160，
    // 无论中间被拆成几步，最终都应该正好是 4 倍。
    const cx = 100;
    let t: ReturnType<typeof applyPinch> = IDENTITY;
    let prev = pinchOf({ x: cx - 20, y: 0 }, { x: cx + 20, y: 0 });
    for (const [a, b] of [
      [cx - 80, cx + 20],
      [cx - 80, cx + 80],
    ] as const) {
      const next = pinchOf({ x: a, y: 0 }, { x: b, y: 0 });
      t = applyPinch(t, prev, next);
      prev = next;
    }
    expect(t.scale).toBeCloseTo(4, 10);
  });
});
