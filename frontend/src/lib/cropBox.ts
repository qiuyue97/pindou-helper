/**
 * 生成图纸的框选：一个**比例锁死**的矩形，在图片范围内移动和缩放。
 *
 * 和识别那边的框（sheetGeometry 里的）是两回事，别混：
 *
 *   识别的框   四个角各自独立，允许超出图片边界（生成器导出的图最外圈常常有
 *              半格留白，夹回去反而把格距压歪）
 *   生成的框   比例必须等于 cols:rows（否则豆子会被拉长），而且**不能超出图片**
 *              ——超出去的那部分根本没有像素可切
 *
 * 全是纯函数：拖拽本身在 jsdom 下难测，把算术抽出来单独钉死。
 */

import type { Rect } from './sheetGeometry';

/** 框最小多少像素。再小就没有采样的意义了。 */
const MIN_SIDE = 8;

/** 把 (rows, cols) 换成宽高比。行列数还没填时给 1，不至于除零。 */
export function aspectOf(rows: number, cols: number): number {
  return rows > 0 && cols > 0 ? cols / rows : 1;
}

/**
 * 图片正中最大的一个指定比例的框。
 *
 * 用户刚传完图、还没动手时就是它——直接给一个「整张图能放下的最大合法框」，
 * 比给一个要用户自己撑开的小框省事得多。
 */
export function fitBox(imgW: number, imgH: number, aspect: number): Rect {
  const wide = imgW / imgH > aspect;
  const w = wide ? imgH * aspect : imgW;
  const h = wide ? imgH : imgW / aspect;
  return [(imgW - w) / 2, (imgH - h) / 2, (imgW + w) / 2, (imgH + h) / 2];
}

/**
 * 平移，夹在图片里。
 *
 * 夹的是**整个框**而不是各条边：碰到边界时框该停住并保持大小，而不是被压扁
 * ——压扁就等于偷偷改了比例，豆子会被拉长。
 */
export function moveBox(rect: Rect, dx: number, dy: number,
                        imgW: number, imgH: number): Rect {
  const w = rect[2] - rect[0];
  const h = rect[3] - rect[1];
  const x = Math.min(Math.max(rect[0] + dx, 0), Math.max(0, imgW - w));
  const y = Math.min(Math.max(rect[1] + dy, 0), Math.max(0, imgH - h));
  return [x, y, x + w, y + h];
}

/**
 * 拖某个角改大小，比例锁死，对角保持不动。
 *
 * 指针不可能正好落在合法比例上，所以取「宽和高各自要求的尺寸里更大的那个」
 * ——框跟着手走而不是缩在手后面。之后再夹进图片里：先按能放下的最大倍率整体
 * 缩回来，**不是**分别夹两条边，那样会改比例。
 */
export function resizeCorner(rect: Rect, corner: 0 | 1 | 2 | 3,
                             px: number, py: number, aspect: number,
                             imgW: number, imgH: number): Rect {
  // 对角：0=左上 1=右上 2=右下 3=左下，所以对角是 (corner + 2) % 4
  const ax = corner === 0 || corner === 3 ? rect[2] : rect[0];
  const ay = corner === 0 || corner === 1 ? rect[3] : rect[1];
  const signX = px >= ax ? 1 : -1;
  const signY = py >= ay ? 1 : -1;

  let w = Math.max(Math.abs(px - ax), Math.abs(py - ay) * aspect, MIN_SIDE);
  let h = w / aspect;
  // 夹进图片：按比例整体缩，不分别夹两条边
  const roomX = signX > 0 ? imgW - ax : ax;
  const roomY = signY > 0 ? imgH - ay : ay;
  const k = Math.min(1, roomX / w, roomY / h);
  w *= k;
  h *= k;

  const x0 = signX > 0 ? ax : ax - w;
  const y0 = signY > 0 ? ay : ay - h;
  return [x0, y0, x0 + w, y0 + h];
}

/**
 * 行列数改了之后把框调成新比例。
 *
 * 保持**中心**不动，并且尽量不缩小——用户框的是「我要这一块」，改豆阵尺寸时
 * 他想的是精细度，不是重新框一遍。放不下时再整体缩回图片里。
 */
export function reaspect(rect: Rect, aspect: number,
                         imgW: number, imgH: number): Rect {
  const cx = (rect[0] + rect[2]) / 2;
  const cy = (rect[1] + rect[3]) / 2;
  const w0 = rect[2] - rect[0];
  const h0 = rect[3] - rect[1];
  // 以原框的面积为准换比例，长边不至于突然暴涨
  let w = Math.max(MIN_SIDE, Math.sqrt(w0 * h0 * aspect));
  let h = w / aspect;
  const k = Math.min(1, imgW / w, imgH / h);
  w *= k;
  h *= k;
  return moveBox([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], 0, 0, imgW, imgH);
}
