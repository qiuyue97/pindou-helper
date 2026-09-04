/**
 * 生成图纸的框选。
 *
 * 一条贯穿全部用例的性质：**比例永远等于 cols:rows**。比例一歪，豆子就被拉长，
 * 而那是用户在成品摆出来之前看不出来的错误。
 */
import { describe, expect, it } from 'vitest';
import { aspectOf, fitBox, moveBox, reaspect, resizeCorner } from './cropBox';
import type { Rect } from './sheetGeometry';

const ratio = (r: Rect) => (r[2] - r[0]) / (r[3] - r[1]);
const inside = (r: Rect, w: number, h: number) =>
  r[0] >= -1e-6 && r[1] >= -1e-6 && r[2] <= w + 1e-6 && r[3] <= h + 1e-6;

describe('aspectOf', () => {
  it('宽高比是 cols:rows，不是 rows:cols', () => {
    expect(aspectOf(50, 100)).toBe(2); // 100 列 50 行 = 扁的
  });

  it('行列数还没填时给 1，不除零', () => {
    expect(aspectOf(0, 0)).toBe(1);
    expect(aspectOf(10, 0)).toBe(1);
  });
});

describe('fitBox', () => {
  it('宽图上按高度顶满，左右居中', () => {
    const r = fitBox(400, 200, 1);
    expect(r).toEqual([100, 0, 300, 200]);
  });

  it('高图上按宽度顶满，上下居中', () => {
    const r = fitBox(200, 400, 1);
    expect(r).toEqual([0, 100, 200, 300]);
  });

  it('比例正好时正好铺满', () => {
    expect(fitBox(400, 200, 2)).toEqual([0, 0, 400, 200]);
  });

  it('永远在图片里，且是要求的比例', () => {
    for (const a of [0.3, 1, 2.5]) {
      const r = fitBox(640, 480, a);
      expect(ratio(r)).toBeCloseTo(a, 6);
      expect(inside(r, 640, 480)).toBe(true);
    }
  });
});

describe('moveBox', () => {
  it('照着位移挪', () => {
    expect(moveBox([10, 10, 50, 30], 5, -4, 200, 200)).toEqual([15, 6, 55, 26]);
  });

  it('碰到边界停住，**大小不变**——压扁就等于偷偷改了比例', () => {
    const r = moveBox([10, 10, 50, 30], -100, -100, 200, 200);
    expect(r).toEqual([0, 0, 40, 20]);
  });

  it('右下角同理', () => {
    const r = moveBox([160, 170, 200, 190], 100, 100, 200, 200);
    expect(r).toEqual([160, 180, 200, 200]);
  });

  it('框比图还大时不会算出负的位置', () => {
    const r = moveBox([0, 0, 300, 300], 50, 50, 200, 200);
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(0);
  });
});

describe('resizeCorner', () => {
  it('拖右下角，左上角不动', () => {
    const r = resizeCorner([20, 20, 60, 60], 2, 120, 100, 1, 400, 400);
    expect(r[0]).toBe(20);
    expect(r[1]).toBe(20);
    expect(ratio(r)).toBeCloseTo(1, 6);
  });

  it('拖左上角，右下角不动', () => {
    const r = resizeCorner([20, 20, 60, 60], 0, 0, 10, 1, 400, 400);
    expect(r[2]).toBe(60);
    expect(r[3]).toBe(60);
    expect(ratio(r)).toBeCloseTo(1, 6);
  });

  it('指针落不到合法比例上时取更大的那个尺寸——框跟着手走，不缩在手后面', () => {
    // 从 (0,0) 往 (100, 20) 拖，比例 1：宽要 100，高要 20，取 100
    const r = resizeCorner([0, 0, 10, 10], 2, 100, 20, 1, 400, 400);
    expect(r[2] - r[0]).toBeCloseTo(100, 6);
    expect(r[3] - r[1]).toBeCloseTo(100, 6);
  });

  it('比例不是 1 时也守得住', () => {
    const r = resizeCorner([0, 0, 10, 10], 2, 90, 90, 3, 400, 400);
    expect(ratio(r)).toBeCloseTo(3, 6);
  });

  it('撑到图外时整体按比例缩回来，**不是**分别夹两条边', () => {
    const r = resizeCorner([0, 0, 10, 10], 2, 999, 999, 2, 300, 100);
    expect(ratio(r)).toBeCloseTo(2, 6);
    expect(inside(r, 300, 100)).toBe(true);
    expect(r[3] - r[1]).toBeCloseTo(100, 6); // 高度顶满
  });

  it('拖过头翻到对面时也保持比例，不会出负宽', () => {
    const r = resizeCorner([100, 100, 140, 140], 2, 20, 20, 1, 400, 400);
    expect(r[2]).toBeGreaterThan(r[0]);
    expect(r[3]).toBeGreaterThan(r[1]);
    expect(ratio(r)).toBeCloseTo(1, 6);
  });

  it('不会缩成零面积', () => {
    const r = resizeCorner([100, 100, 140, 140], 2, 100, 100, 1, 400, 400);
    expect(r[2] - r[0]).toBeGreaterThan(0);
  });
});

describe('reaspect', () => {
  it('改了行列数之后框跟着换比例，中心不动', () => {
    const r = reaspect([100, 100, 200, 200], 2, 640, 480);
    expect(ratio(r)).toBeCloseTo(2, 6);
    expect((r[0] + r[2]) / 2).toBeCloseTo(150, 6);
    expect((r[1] + r[3]) / 2).toBeCloseTo(150, 6);
  });

  it('按面积换比例，长边不会突然暴涨', () => {
    const r = reaspect([0, 0, 100, 100], 4, 1000, 1000);
    // 面积守恒：宽 200 高 50，而不是「宽变成 400 高不动」
    expect(r[2] - r[0]).toBeCloseTo(200, 6);
    expect(r[3] - r[1]).toBeCloseTo(50, 6);
  });

  it('放不下就整体缩回图片里，比例照旧', () => {
    const r = reaspect([0, 0, 200, 200], 5, 300, 200);
    expect(ratio(r)).toBeCloseTo(5, 6);
    expect(inside(r, 300, 200)).toBe(true);
  });
});
