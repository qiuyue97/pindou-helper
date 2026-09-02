/**
 * 网格几何：拖角、吸附、切格子、屏幕↔图像坐标。
 *
 * 全部是纯函数，因为 canvas 在 jsdom 下几乎测不了。把算术抽在这里，
 * 组件那一层就只需要验证「画布上调了什么」。
 *
 * 关于「四个角」：它们是**轴对齐矩形**的四角，拖一个角改的是 rect 的边界。
 * 自由四点透视是既定的非目标——只支持生成器导出的规整图片，不支持手机拍照。
 */

export type Rect = [number, number, number, number];
/** 0=左上 1=右上 2=右下 3=左下 */
export type Corner = 0 | 1 | 2 | 3;

export interface View {
  /** 图像像素 → 屏幕像素的倍率 */
  scale: number;
  /** 图像原点在容器里的偏移（屏幕像素） */
  ox: number;
  oy: number;
}

/** 鼠标 22px，手指 44px。手指没有像素精度。 */
export const HIT_MOUSE = 22;
export const HIT_TOUCH = 44;

/** 吸附容差，图像像素。 */
export const SNAP_TOL = 6;

export function corners(rect: Rect): Array<[number, number]> {
  const [x0, y0, x1, y1] = rect;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** 命中哪个角。多个都在半径内时取最近的。坐标和半径都在**图像**空间。 */
export function hitCorner(rect: Rect, x: number, y: number, radius: number): Corner | null {
  let best: Corner | null = null;
  let bestD = radius;
  corners(rect).forEach(([cx, cy], i) => {
    const d = Math.hypot(cx - x, cy - y);
    if (d <= bestD) {
      bestD = d;
      best = i as Corner;
    }
  });
  return best;
}

/** 至少给矩形留这么宽，免得被拖成零面积或翻转的。 */
const MIN_SIDE = 1;

export function moveCorner(rect: Rect, corner: Corner, x: number, y: number): Rect {
  const [x0, y0, x1, y1] = rect;
  switch (corner) {
    case 0:
      return [Math.min(x, x1 - MIN_SIDE), Math.min(y, y1 - MIN_SIDE), x1, y1];
    case 1:
      return [x0, Math.min(y, y1 - MIN_SIDE), Math.max(x, x0 + MIN_SIDE), y1];
    case 2:
      return [x0, y0, Math.max(x, x0 + MIN_SIDE), Math.max(y, y0 + MIN_SIDE)];
    default:
      return [Math.min(x, x1 - MIN_SIDE), y0, x1, Math.max(y, y0 + MIN_SIDE)];
  }
}

/**
 * 吸附到容差内最近的靶点。
 *
 * 靶点是**真实检测到的分隔线**，不是推算出来的格点：用户拖到一条真线上才该吸住，
 * 拖到一条算出来但图上没有的线上不该。检测失败时靶点是空的，这个函数原样返回
 * ——那正是手动模式该有的行为。
 */
export function snap(value: number, targets: number[], tol: number = SNAP_TOL): number {
  let best = value;
  let bestD = tol;
  for (const t of targets) {
    const d = Math.abs(t - value);
    if (d <= bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/**
 * 第 (r, c) 格在原图里的矩形，可以直接喂给 `ctx.drawImage`。
 *
 * 均分，**不取整**——后端 `sample_cells` 也是均分的，两边必须切在同一个地方，
 * 否则用户看到的格子和识别用的格子不是同一个。
 */
export function cellRect(rect: Rect, rows: number, cols: number, r: number, c: number) {
  const [x0, y0, x1, y1] = rect;
  const sw = (x1 - x0) / cols;
  const sh = (y1 - y0) / rows;
  return { sx: x0 + c * sw, sy: y0 + r * sh, sw, sh };
}

export function toImage(px: number, py: number, v: View): [number, number] {
  return [(px - v.ox) / v.scale, (py - v.oy) / v.scale];
}

export function toScreen(ix: number, iy: number, v: View): [number, number] {
  return [ix * v.scale + v.ox, iy * v.scale + v.oy];
}
