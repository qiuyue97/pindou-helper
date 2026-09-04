"""从一张普通图片生成拼豆图纸。

和 `pipeline` 那条线是**反过来**的：那边是「图纸 → 每格是什么豆」，这边是
「照片 → 每格该摆什么豆」。共用的只有色卡和 CIEDE2000。

为什么不能把每格的像素平均一下就配色卡——三层独立的错，叠在一起就是「糊」：

  1. **在 sRGB 里平均本身就是错的**。sRGB 是 gamma 编码的，两个值的算术平均
     不是这两个颜色的平均。这里全程在 CIELAB 里算，那是感知均匀的空间。
  2. **一格跨在边界上时，平均值是两边都不存在的颜色**。60x60 的豆阵下大多数
     格子都跨着轮廓，于是边缘整体消失、对比度塌掉。
  3. **再去配色卡会把错误放大**：那个「谁都不是」的均值吸附到第三个豆号上，
     看起来和两边都不像。

所以降采样这一步给了两种做法，用户按图选：

  slic  网格约束的超像素（Gerstner et al. 2012, *Pixelated Image Abstraction*
        的前一半）。每个输出格子是一个超像素，在 (L,a,b,x,y) 五维里做 k-means，
        中心初始化在网格上、只许在一格范围内漂。**格子边界会顺着轮廓弯**，于是
        一条轮廓落在一排豆子上，而不是抹在两排之间。贴豆最看重的就是这个。
        原论文的后一半（MCDA 学调色板）这里用不上——我们的色卡是固定的。

  dpid  反向双边滤波（Weber et al. 2016）：越偏离局部均值的像素权重越高，于是
        一小块和周围不一样的东西不会被洗掉。不迭代，瞬出。
        **在边界上反而不如 SLIC**——它强调偏离均值的像素，跨界那一格于是落在
        两色正中间（比面积平均还靠中）。这是它的固有代价，换来的是细密纹理
        （头发、织物、文字）留得住。所以两种是「轮廓优先」和「细节优先」的取舍，
        不是「好」和「更好」。

**不做抖动。** 豆子是一颗一颗摆的，5mm 间距下棋盘纹不会在视觉上混色，只会让
豆号清单多出一堆「买一包用三颗」的颜色。
"""

from __future__ import annotations

import logging

import numpy as np

from app.colour import Palette, delta_e00, srgb_to_lab

log = logging.getLogger("pindou.generate")

#: 每格采多少源像素（边长）。8x8=64 个样本足够定一格的颜色，再高对结果没有可见
#: 改善，只是把 SLIC 那一步的耗时按平方放大。
CELL_PX = 8
#: DPID 的指数。1 附近是原文推荐的区间：越大越锐、越容易把噪点当细节。
DPID_LAMBDA = 1.0
#: SLIC 迭代次数。八次之后中心基本不动了，再多只是白跑。
SLIC_ITERS = 8
#: SLIC 里位置相对颜色的权重。大 = 格子更方正，小 = 更贴轮廓。
SLIC_COMPACT = 12.0
#: 提饱和的倍率。固定色卡配出来总会比原图淡一档，这里补回来一点。
SATURATION = 1.10


def _cell_bounds(n: int, total: int) -> np.ndarray:
    """把 `total` 个像素**均分**成 n 段，返回 n+1 个边界（不取整的整数下标）。

    均分而不是按整数步长走，否则最后一段会短一大截——100 格 1075 像素的图，
    步长取 10 的话最后一格只剩 5 个像素，那一排豆子的颜色全是错的。
    """
    return np.round(np.linspace(0, total, n + 1)).astype(int)


def _area_mean(lab: np.ndarray, rows: int, cols: int) -> np.ndarray:
    """老老实实的面积平均，在 Lab 里算。DPID 要拿它当局部均值的基准。"""
    ys, xs = _cell_bounds(rows, lab.shape[0]), _cell_bounds(cols, lab.shape[1])
    out = np.empty((rows, cols, 3), float)
    for r in range(rows):
        band = lab[ys[r]:ys[r + 1]]
        for c in range(cols):
            out[r, c] = band[:, xs[c]:xs[c + 1]].reshape(-1, 3).mean(axis=0)
    return out


def dpid(lab: np.ndarray, rows: int, cols: int,
         lam: float = DPID_LAMBDA) -> np.ndarray:
    """Weber et al. 2016 的降采样。

        O[p] = (1/k) * sum_q  I[q] * ||I[q] - Ĩ[p]||^lam

    `Ĩ` 是普通的面积平均。**离局部均值越远的像素权重越高**——和双边滤波正好反
    过来：双边压制差异，这里强调差异。直觉是「一小块和周围不一样的东西，信息量
    比一大片相同的颜色高」，正是缩到几十像素时最先丢掉的那部分。

    权重全零（这一格里所有像素颜色完全一样）时退回平均值，不然会 0/0。
    """
    base = _area_mean(lab, rows, cols)
    ys, xs = _cell_bounds(rows, lab.shape[0]), _cell_bounds(cols, lab.shape[1])
    out = np.empty((rows, cols, 3), float)
    for r in range(rows):
        band = lab[ys[r]:ys[r + 1]]
        for c in range(cols):
            px = band[:, xs[c]:xs[c + 1]].reshape(-1, 3)
            w = np.linalg.norm(px - base[r, c], axis=1) ** lam
            s = w.sum()
            out[r, c] = base[r, c] if s <= 1e-9 else (px * w[:, None]).sum(0) / s
    return out


def grid_slic(lab: np.ndarray, rows: int, cols: int,
              iters: int = SLIC_ITERS,
              compact: float = SLIC_COMPACT,
              on_iter=None) -> np.ndarray:
    """网格约束的 SLIC 超像素（Gerstner et al. 2012 的前一半）。

    每个输出格子是一个超像素：在 (L,a,b,x,y) 里做 k-means，中心初始化在网格
    结点上，每个像素只在**自己那一格和相邻八格**的中心之间竞争——约束住之后
    超像素既不会跑掉也不会消失，输出仍然是规整的 rows x cols 网格，但**边界
    可以顺着轮廓弯**。

    距离 = dE_lab + compact * d_pixel / cell，两项都无量纲化到「一格」的尺度上，
    所以 `compact` 的含义在任何图上都一样：大 = 更方正，小 = 更贴轮廓。

    原论文还对中心做了 Laplacian 平滑（避免超像素退化成 6 连通的蜂窝）。这里
    把中心**夹在自己那一格的范围内**达到同样的目的，而且更简单、更好解释。

    实现上按**九个邻居偏移**整幅算，不是按 rows*cols 个中心各算一小块：后者在
    100x100 的图纸上要跑十几万次小 numpy 调用，光 Python 的调用开销就十几秒，
    而结果一模一样（每个像素能竞争到的中心集合是同一个）。
    """
    h, w = lab.shape[:2]
    ch, cw = h / rows, w / cols
    cy = (np.arange(rows) + 0.5) * ch
    cx = (np.arange(cols) + 0.5) * cw
    ctr_y = np.repeat(cy[:, None], cols, axis=1)
    ctr_x = np.repeat(cx[None, :], rows, axis=0)
    ctr_lab = _area_mean(lab, rows, cols)

    yy = np.arange(h, dtype=float)[:, None]
    xx = np.arange(w, dtype=float)[None, :]
    scale = compact / max(ch, cw)

    # 每个像素归属的那一格
    home_r = np.clip((yy / ch).astype(np.int32), 0, rows - 1)
    home_c = np.clip((xx / cw).astype(np.int32), 0, cols - 1)
    offsets = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1)]
    # 搜索窗口：一个中心只能抢**它那一格向外各半格**范围内的像素（论文里的 2S）。
    # 这是硬截断，不是靠距离项去压——颜色差能到 100，位置项只有十几，光靠加权
    # 的话一个远处的同色中心照样抢得走，网格约束就形同虚设。
    fl_nom_y = np.repeat(cy[:, None], cols, axis=1).reshape(-1)
    fl_nom_x = np.repeat(cx[None, :], rows, axis=0).reshape(-1)

    labels = np.zeros((h, w), np.int32)
    lo_y = np.arange(rows)[:, None] * ch
    lo_x = np.arange(cols)[None, :] * cw
    for it in range(iters):
        best = np.full((h, w), np.inf)
        fl_lab = ctr_lab.reshape(-1, 3)
        fl_y, fl_x = ctr_y.reshape(-1), ctr_x.reshape(-1)
        for dr, dc in offsets:
            k = (np.clip(home_r + dr, 0, rows - 1) * cols
                 + np.clip(home_c + dc, 0, cols - 1))
            d = np.linalg.norm(lab - fl_lab[k], axis=2)
            d += scale * np.hypot(yy - fl_y[k], xx - fl_x[k])
            d = np.where((np.abs(yy - fl_nom_y[k]) < ch)
                         & (np.abs(xx - fl_nom_x[k]) < cw), d, np.inf)
            win = d < best
            best = np.where(win, d, best)
            labels = np.where(win, k, labels)

        # 重算中心。空超像素保留上一轮的值——约束住之后基本不会出现，出现了也
        # 不能让它变成 NaN 把一整格弄丢。
        flat = labels.reshape(-1)
        n = np.bincount(flat, minlength=rows * cols).astype(float)
        alive = n > 0
        for i in range(3):
            tot = np.bincount(flat, weights=lab[..., i].reshape(-1),
                              minlength=rows * cols)
            ctr_lab.reshape(-1, 3)[alive, i] = tot[alive] / n[alive]
        for arr, coord in ((ctr_y, np.broadcast_to(yy, (h, w))),
                           (ctr_x, np.broadcast_to(xx, (h, w)))):
            tot = np.bincount(flat, weights=np.ascontiguousarray(coord).reshape(-1),
                              minlength=rows * cols)
            arr.reshape(-1)[alive] = tot[alive] / n[alive]
        # 夹回自己那一格：这是「网格约束」四个字的全部内容
        ctr_y[:] = np.clip(ctr_y, lo_y, lo_y + ch)
        ctr_x[:] = np.clip(ctr_x, lo_x, lo_x + cw)
        if on_iter:
            on_iter(it + 1, iters)

    return ctr_lab


def saturate(lab: np.ndarray, k: float = SATURATION) -> np.ndarray:
    """把 a/b 拉长一点。L 不动——提亮度会把整张图冲白。

    固定色卡配出来的东西总比原图淡一档：每一格都被吸附到最近的那颗豆子上，
    而「最近」在色度上永远是往里收的。这里补回来一点。
    """
    out = lab.copy()
    out[..., 1:] *= k
    return out


def despeckle(labels: np.ndarray) -> np.ndarray:
    """把孤立的单颗豆子并进周围。

    一颗四邻都不同的豆子，视觉上是噪点，实物上还要为它单买一整包。八邻域里
    出现次数最多的那个色号顶上去；平局时保持原样，不瞎猜。
    """
    rows, cols = labels.shape
    out = labels.copy()
    pad = np.pad(labels, 1, mode="edge")
    for r in range(rows):
        for c in range(cols):
            ring = np.concatenate([pad[r, c:c + 3], pad[r + 2, c:c + 3],
                                   pad[r + 1, c:c + 1], pad[r + 1, c + 2:c + 3]])
            if (ring == labels[r, c]).any():
                continue                      # 不是孤立的，留着
            vals, cnt = np.unique(ring, return_counts=True)
            top = cnt.max()
            if (cnt == top).sum() == 1:       # 平局不猜
                out[r, c] = vals[cnt.argmax()]
    return out


def to_palette(lab: np.ndarray, palette: Palette) -> tuple[np.ndarray, np.ndarray]:
    """每一格配最近的豆号。返回 (色号下标, 到那颗豆子的 dE00)。

    用 CIEDE2000 而不是 Lab 欧氏距离：Lab 只是「大致」感知均匀，在饱和的红和
    蓝上偏得厉害，而拼豆色卡在那两块恰好最密。
    """
    flat = lab.reshape(-1, 1, 3)
    de = delta_e00(flat, palette.lab[None, :, :])
    idx = de.argmin(axis=1)
    return idx.reshape(lab.shape[:2]), de.min(axis=1).reshape(lab.shape[:2])


def _prepare(rgb: np.ndarray, rows: int, cols: int) -> np.ndarray:
    """裁好的原图 → 每格约 CELL_PX 像素的 Lab 图。

    先缩一道是为了封顶：一张四千万像素的照片直接跑 SLIC 要几十秒，而每格超过
    十几个源像素之后结果就不再变了——降采样本来就是在丢信息。
    """
    import cv2

    h, w = rgb.shape[:2]
    th, tw = rows * CELL_PX, cols * CELL_PX
    if h > th or w > tw:
        # INTER_AREA 是缩小专用的：它是精确的面积平均，不会像 INTER_LINEAR 那样漏采样
        rgb = cv2.resize(rgb, (min(w, tw), min(h, th)), interpolation=cv2.INTER_AREA)
    # float32 就够：Lab 的量级是 0..100，而这一步的瓶颈是内存带宽不是精度。
    return srgb_to_lab(rgb).astype(np.float32)


def generate(rgb: np.ndarray, rows: int, cols: int, palette: Palette, *,
             style: str = "slic", clean: bool = True,
             on_step=None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """一张裁好的图 → (每格的色号下标, 每格的 dE00, 每格的目标 Lab)。

    `rgb` 是 **RGB** 顺序的 uint8 (H, W, 3)——不是 cv2 默认的 BGR。
    """
    if rows < 1 or cols < 1:
        raise ValueError("行列数必须为正")
    if style not in ("slic", "dpid"):
        raise ValueError(f"未知的生成方式: {style}")

    def say(text: str, pct: int) -> None:
        if on_step:
            on_step(text, pct)

    say("读取图片", 10)
    lab = _prepare(rgb, rows, cols)

    if style == "slic":
        say("按轮廓归拢", 30)
        # 这一段是整条流水线里唯一慢的地方（100x100 要几秒），按迭代往前爬。
        # 不然进度条会停在 30% 十几秒，比没有进度条更像卡死。
        small = grid_slic(lab, rows, cols,
                          on_iter=lambda i, n: say(f"按轮廓归拢 {i}/{n}",
                                                   30 + round(40 * i / n)))
    else:
        say("快速降采样", 30)
        small = dpid(lab, rows, cols)

    say("配色卡", 75)
    idx, de = to_palette(saturate(small), palette)
    if clean:
        say("清理孤点", 90)
        idx = despeckle(idx)
    return idx, de, small
