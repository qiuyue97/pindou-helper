/**
 * 网格几何。全是纯函数，因为 canvas 在 jsdom 下几乎测不了——把算术抽出来单独
 * 钉死，画布那一层就只剩「调了什么」需要验证。
 *
 * 四个角是**轴对齐矩形**的四角：拖一个角改的是 rect 的边界，不是自由四点透视。
 */
import { describe, expect, it } from 'vitest';
import {
  cellRect,
  corners,
  fitView,
  gridCount,
  HIT_MOUSE,
  HIT_TOUCH,
  hitCorner,
  LOUPE_CELLS,
  loupeAnchor,
  loupeSpan,
  moveCorner,
  pitchOf,
  snap,
  toImage,
  toScreen,
  zoomAt,
  type Rect,
} from './sheetGeometry';

const R: Rect = [10, 20, 110, 220];

describe('corners', () => {
  it('按 TL, TR, BR, BL 的顺序给出四角', () => {
    expect(corners(R)).toEqual([
      [10, 20],
      [110, 20],
      [110, 220],
      [10, 220],
    ]);
  });
});

describe('hitCorner', () => {
  it('在半径内命中', () => {
    expect(hitCorner(R, 12, 22, HIT_MOUSE)).toBe(0);
    expect(hitCorner(R, 108, 218, HIT_MOUSE)).toBe(2);
  });

  it('半径外不命中', () => {
    expect(hitCorner(R, 60, 120, HIT_MOUSE)).toBeNull();
  });

  it('触摸半径更大——手指没有像素精度', () => {
    // 到左上角 (10,20) 的距离是 hypot(25,25) ≈ 35.4：鼠标半径够不着，手指够得着
    expect(hitCorner(R, 35, 45, HIT_MOUSE)).toBeNull();
    expect(hitCorner(R, 35, 45, HIT_TOUCH)).toBe(0);
  });

  it('两个角都在半径内时取更近的那个', () => {
    const tiny: Rect = [0, 0, 10, 10];
    expect(hitCorner(tiny, 1, 1, HIT_TOUCH)).toBe(0);
    expect(hitCorner(tiny, 9, 1, HIT_TOUCH)).toBe(1);
  });
});

describe('moveCorner', () => {
  it('拖左上只动 x0/y0', () => {
    expect(moveCorner(R, 0, 30, 40)).toEqual([30, 40, 110, 220]);
  });

  it('拖右下只动 x1/y1', () => {
    expect(moveCorner(R, 2, 90, 200)).toEqual([10, 20, 90, 200]);
  });

  it('拖右上动 x1 和 y0', () => {
    expect(moveCorner(R, 1, 90, 40)).toEqual([10, 40, 90, 220]);
  });

  it('拖左下动 x0 和 y1', () => {
    expect(moveCorner(R, 3, 30, 200)).toEqual([30, 20, 110, 200]);
  });

  it('不允许把矩形拖成翻转的', () => {
    const out = moveCorner(R, 0, 999, 999);
    expect(out[0]).toBeLessThan(out[2]);
    expect(out[1]).toBeLessThan(out[3]);
  });
});

describe('snap', () => {
  it('吸到容差内最近的靶点', () => {
    expect(snap(103, [50, 100, 150], 6)).toBe(100);
  });

  it('容差外不动', () => {
    expect(snap(120, [50, 100, 150], 6)).toBe(120);
  });

  it('没有靶点时原样返回——检测失败是正常路径，手动模式就该这样', () => {
    expect(snap(120, [], 6)).toBe(120);
  });

  it('两个靶点都在容差内时取更近的', () => {
    expect(snap(101, [100, 104], 6)).toBe(100);
    expect(snap(103, [100, 104], 6)).toBe(104);
  });
});

describe('cellRect', () => {
  it('把矩形均分——后端 sample_cells 也是这么切的，两边必须一致', () => {
    expect(cellRect([0, 0, 100, 50], 5, 10, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 10, sh: 10 });
    expect(cellRect([0, 0, 100, 50], 5, 10, 4, 9)).toEqual({ sx: 90, sy: 40, sw: 10, sh: 10 });
  });

  it('小数 rect 不做取整——亚像素偏移正是采样要的', () => {
    const c = cellRect([0.5, 0.25, 10.5, 5.25], 2, 4, 1, 2);
    expect(c.sx).toBeCloseTo(5.5);
    expect(c.sy).toBeCloseTo(2.75);
    expect(c.sw).toBeCloseTo(2.5);
    expect(c.sh).toBeCloseTo(2.5);
  });

  it('铺满整个 rect，不重叠不留缝', () => {
    const rect: Rect = [3, 7, 103, 57];
    const last = cellRect(rect, 5, 10, 4, 9);
    expect(last.sx + last.sw).toBeCloseTo(rect[2]);
    expect(last.sy + last.sh).toBeCloseTo(rect[3]);
  });
});

describe('坐标变换', () => {
  const view = { scale: 2, ox: 30, oy: 10 };

  it('屏幕坐标换回图像坐标', () => {
    expect(toImage(70, 50, view)).toEqual([20, 20]);
  });

  it('来回换是恒等', () => {
    const [ix, iy] = toImage(123, 456, view);
    const [sx, sy] = toScreen(ix, iy, view);
    expect(sx).toBeCloseTo(123);
    expect(sy).toBeCloseTo(456);
  });
});

// ---------- 视图：缩放和平移 ----------

describe('fitView', () => {
  it('把整张图居中放进框里', () => {
    // 400x300 的图放进 200x200 的框：按宽度缩一半，上下留白
    expect(fitView(400, 300, 200, 200)).toEqual({ scale: 0.5, ox: 0, oy: 25 });
  });

  it('框比图大就放大到贴边', () => {
    expect(fitView(100, 100, 300, 200)).toEqual({ scale: 2, ox: 50, oy: 0 });
  });

  it('尺寸缺失时给一个不会把界面搞崩的视图', () => {
    expect(fitView(400, 300, 0, 0)).toEqual({ scale: 1, ox: 0, oy: 0 });
  });
});

describe('zoomAt', () => {
  it('定点在缩放前后停在原地', () => {
    const v = { scale: 1, ox: 0, oy: 0 };
    const [ix, iy] = toImage(120, 80, v);
    const next = zoomAt(v, 120, 80, 2, 0.1, 10);
    expect(next.scale).toBe(2);
    expect(toScreen(ix, iy, next)).toEqual([120, 80]);
  });

  it('缩放倍率夹在上下限之间', () => {
    const v = { scale: 5, ox: 0, oy: 0 };
    expect(zoomAt(v, 0, 0, 10, 0.5, 8).scale).toBe(8);
    expect(zoomAt(v, 0, 0, 0.001, 0.5, 8).scale).toBe(0.5);
  });
});

// ---------- 行列数跟着框走 ----------

describe('pitchOf', () => {
  it('从检测结果反推格距', () => {
    // 真实数据：3492x3791 的图，框 -22..3514，68x68 -> 格距正好 52
    expect(pitchOf([-22, -22, 3514, 3514], 68, 68)).toEqual([52, 52]);
  });

  it('检测失败时没有格距', () => {
    expect(pitchOf([0, 0, 100, 100], 0, 0)).toEqual([0, 0]);
  });
});

describe('gridCount', () => {
  it('按格距四舍五入出格数', () => {
    expect(gridCount(52 * 68, 52)).toBe(68);
    // 框往里缩了两格
    expect(gridCount(52 * 66, 52)).toBe(66);
  });

  it('框没对齐时就近取整', () => {
    expect(gridCount(52 * 66 + 20, 52)).toBe(66);
    expect(gridCount(52 * 66 + 40, 52)).toBe(67);
  });

  it('至少一格', () => {
    expect(gridCount(3, 52)).toBe(1);
  });

  it('算不出来就说算不出来，不瞎猜', () => {
    expect(gridCount(500, 0)).toBe(0);
    expect(gridCount(0, 52)).toBe(0);
  });
});

describe('放大镜', () => {
  it('有格距就看三格——中间那条边，两边各留一格判断格距对不对得上', () => {
    expect(loupeSpan(52, 52)).toBe(52 * LOUPE_CELLS);
  });

  it('横竖格距不一样时按大的来，两个方向都装得下', () => {
    expect(loupeSpan(30, 52)).toBe(52 * LOUPE_CELLS);
  });

  it('检测失败没有格距时给个保底窗口，不至于除零或者放大到一片马赛克', () => {
    expect(loupeSpan(0, 0)).toBeGreaterThan(0);
  });

  it('永远贴在手指所在象限的对角——自己被手挡住的放大镜没有意义', () => {
    expect(loupeAnchor(10, 10, 400, 300)).toEqual(['bottom', 'right']);
    expect(loupeAnchor(390, 10, 400, 300)).toEqual(['bottom', 'left']);
    expect(loupeAnchor(10, 290, 400, 300)).toEqual(['top', 'right']);
    expect(loupeAnchor(390, 290, 400, 300)).toEqual(['top', 'left']);
  });
});
