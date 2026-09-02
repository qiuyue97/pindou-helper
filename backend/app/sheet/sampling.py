"""把一块矩形均分成 rows×cols，逐格取出「豆子什么颜色」和「上面印了什么」。

下游只吃 (rect, rows, cols)——网格是**均分**的，检测出来的 pitch 只用于给用户
一个初始猜测。这一点让手动兜底几乎白送：用户拖出来的框和检测出来的框在这里
走完全相同的代码。
"""

import cv2
import numpy as np

#: 重采样倍率，也是字形对齐的亚像素分辨率
UP = 3


def sample_cells(im, rect, rows, cols, inset_frac=0.15, core_frac=0.52):
    """环形采样的填充色，以及这格上有没有印东西。

    环向内跳过画出来的分隔线（和它旁边的 JPEG 振铃），向中心挖掉印着的色号。
    对整格取众数会被两者中面积大的那个拽走——小格上一个两位数色号能盖住一半以上
    面积，众数就变成了字的颜色，早期把标尺格采成黑色就是这么来的。

    两个边界都是 pitch 的**比例**，所以 27px 的图和 13px 的图走同一段代码。

    返回 `(fill, inked)`，其中 fill 是 **RGB**（入参 im 是 cv2 的 BGR）。
    """
    x0, y0, x1, y1 = rect
    px, py = (x1 - x0) / cols, (y1 - y0) / rows
    H, W = im.shape[:2]
    fill = np.zeros((rows, cols, 3), np.uint8)
    inked = np.zeros((rows, cols), bool)
    for i in range(rows):
        ya, yb = y0 + i * py, y0 + (i + 1) * py
        for j in range(cols):
            xa, xb = x0 + j * px, x0 + (j + 1) * px
            ia = max(0, int(ya + py * inset_frac))
            ib = min(H, int(yb - py * inset_frac))
            ja = max(0, int(xa + px * inset_frac))
            jb = min(W, int(xb - px * inset_frac))
            if ib - ia < 3 or jb - ja < 3:
                continue                      # 格子小到无从采样，留零值
            patch = im[ia:ib, ja:jb].astype(np.int16)
            ring = np.ones(patch.shape[:2], bool)
            cy = (ib - ia) * (1 - core_frac) / 2
            cx = (jb - ja) * (1 - core_frac) / 2
            ring[int(cy):int(ib - ia - cy), int(cx):int(jb - ja - cx)] = False
            s = patch[ring] if ring.sum() >= 8 else patch.reshape(-1, 3)
            # 量化到 6 的桶取众数，再在桶心附近求均值——直接取均值会被反锯齿的
            # 边缘像素拉偏，直接取众数又丢掉了亚色阶的精度
            q = (s // 6).astype(np.int32)
            v, c = np.unique(q[:, 0] * 10000 + q[:, 1] * 100 + q[:, 2],
                             return_counts=True)
            b = v[c.argmax()]
            cc = np.array([(b // 10000) * 6 + 3, ((b // 100) % 100) * 6 + 3,
                           (b % 100) * 6 + 3], float)
            m = np.linalg.norm(s - cc, axis=1) < 10
            col = s[m].mean(axis=0) if m.sum() > 3 else cc
            fill[i, j] = col.astype(np.uint8)
            allpx = patch.reshape(-1, 3)
            inked[i, j] = (np.linalg.norm(allpx - col, axis=1) > 60).mean() > 0.02
    return fill[..., ::-1], inked          # BGR -> RGB


def build_glyphs(im, fill, rect, rows, cols, up=UP):
    """每格一张除掉填充色的墨迹图，全部落在同一个亚像素栅格上。

    每格按它**真实的小数偏移**重采样——没有这一步，类的中位图只是各种相位的糊影。

    `ink = max|patch − fill|` 跨通道取最大。除掉填充色之后墨迹图与颜色无关，
    所以同一个色号被颜色抖动裂成两个类时，两边的字形仍然可比。

    ---

    **不要把它改成「整块 rect 一次放大再切片」。试过了，两条路都不成立：**

    直接切：切片起点 `round((j*px+ix)*up)` 有最多半个大图像素的相位误差，实测
    pitch 13 时与逐格版的均值差 16.97/255（最大 69），而相位对齐正是这个函数
    存在的唯一理由。
    让 `px*up` 取整以消掉舍入：每格会累积漂移，104 格下漂十几个源像素，更糟。

    而且不值得。实测最难的真图（0968037，104x104 = 10,816 格）整个 CV 阶段
    1.43s，这一步占 0.56s；整图版也只快 2.1x，省下 0.3s。MinerU 的排队是秒到
    数十秒级，这里根本不是瓶颈。
    """
    x0, y0, x1, y1 = rect
    px, py = (x1 - x0) / cols, (y1 - y0) / rows
    fill_bgr = np.asarray(fill)[..., ::-1].astype(np.float32)
    ix, iy, w, h = _glyph_box(px, py, up)
    ink = np.zeros((rows * cols, h, w), np.float32)
    for i in range(rows):
        for j in range(cols):
            ox, oy = x0 + j * px + ix, y0 + i * py + iy
            M = np.array([[up, 0, -ox * up], [0, up, -oy * up]], np.float32)
            p = cv2.warpAffine(im, M, (w, h), flags=cv2.INTER_CUBIC,
                               borderMode=cv2.BORDER_REPLICATE)
            ink[i * cols + j] = np.abs(p.astype(np.float32)
                                       - fill_bgr[i, j]).max(axis=2)
    return ink


def _glyph_box(px, py, up):
    """一格的内缩量和放大后的尺寸。

    内缩量用**像素**而不是比例：分隔线不管 pitch 多大都是 ~2px，用百分比在 28px
    的格上只是修边，在 13px 的格上会吃掉 2px 的字，而那恰恰是最没字可吃的那张图。
    """
    ix = min(max(1.5, px * 0.06), 4.0)
    iy = min(max(1.5, py * 0.06), 4.0)
    w = max(1, round((px - 2 * ix) * up))
    h = max(1, round((py - 2 * iy) * up))
    return ix, iy, w, h


