"""合成一张拼豆图纸。

真实图纸不在这个仓库里，而且就算搬进来，它也只能支撑「总体准确率」这种粗断言。
合成图纸的真值是我们自己画进去的，所以能断言到具体某一格——这才是单元测试要的
精度。JPEG 损伤用 `jitter` 近似：填充色加一点噪声，色号不变。

画出来的东西刻意保持和真实图纸同构：格子等距、格间有 2px 分隔线、色号印在正中、
四周留白（真实图纸的留白里有标尺和图例，这里只留白，因为 extent 判定的是「另一
轴的分隔线有没有穿过这条带」，空白和标尺在这一点上等价）。
"""

from dataclasses import dataclass

import cv2
import numpy as np

from app.colour import load_palette


@dataclass
class SynthSheet:
    image: np.ndarray        # (H, W, 3) uint8, BGR —— 和 cv2.imdecode 一致
    rect: list[float]        # [x0, y0, x1, y1]
    rows: int
    cols: int
    codes: list[list[str]]   # 逐格真值
    palette: str


def make_sheet(codes, pitch=27, margin=40, sep=(60, 60, 60), sep_w=2,
               jitter=0.0, seed=0, font_scale=0.34, palette="221") -> SynthSheet:
    """按给定的色号矩阵画一张图纸。

    `pitch` 用 27 是有理由的：真实样本里 IMG_8422 是 27.7，0968037 是 13.4，
    27 落在「字还看得清」的那一档，13 那一档由调用方显式指定。
    """
    pal = load_palette(palette)
    rows, cols = len(codes), len(codes[0])
    H = margin * 2 + rows * pitch
    W = margin * 2 + cols * pitch
    img = np.full((H, W, 3), 255, np.uint8)
    rng = np.random.default_rng(seed)

    for i in range(rows):
        for j in range(cols):
            code = codes[i][j]
            rgb = pal.rgb[pal.codes.index(code)].copy()
            if jitter:
                rgb = np.clip(rgb + rng.normal(0, jitter, 3), 0, 255)
            y0, x0 = margin + i * pitch, margin + j * pitch
            img[y0:y0 + pitch, x0:x0 + pitch] = rgb[::-1]   # RGB -> BGR

            # 字的颜色取黑或白，哪个和填充色对比大用哪个——真实生成器也这么干
            lum = float(rgb @ [0.299, 0.587, 0.114])
            ink = (0, 0, 0) if lum > 128 else (255, 255, 255)
            (tw, th), _ = cv2.getTextSize(code, cv2.FONT_HERSHEY_SIMPLEX,
                                          font_scale, 1)
            cv2.putText(img, code,
                        (x0 + (pitch - tw) // 2, y0 + (pitch + th) // 2),
                        cv2.FONT_HERSHEY_SIMPLEX, font_scale, ink, 1,
                        cv2.LINE_AA)

    # 分隔线最后画，盖在格子上，和真实图纸一样
    for j in range(cols + 1):
        x = margin + j * pitch
        cv2.line(img, (x, margin), (x, margin + rows * pitch), sep, sep_w)
    for i in range(rows + 1):
        y = margin + i * pitch
        cv2.line(img, (margin, y), (margin + cols * pitch, y), sep, sep_w)

    return SynthSheet(
        image=img,
        rect=[float(margin), float(margin),
              float(margin + cols * pitch), float(margin + rows * pitch)],
        rows=rows, cols=cols, codes=[list(r) for r in codes], palette=palette,
    )


def make_random_sheet(rows, cols, n_codes, seed=0, palette="221",
                      **kw) -> SynthSheet:
    """随机排布 n_codes 个色号，保证每个都至少出现一次。

    色号是从色卡里**等距**挑的，不是随机挑：随机挑很容易抽到两个 dE00 只差 1 的
    邻居，那时聚类分不开是正确行为，测试却会报错——测的就变成了色卡而不是代码。
    """
    pal = load_palette(palette)
    step = max(1, len(pal.codes) // n_codes)
    chosen = [pal.codes[k * step] for k in range(n_codes)]
    rng = np.random.default_rng(seed)
    flat = list(chosen)                                  # 先保证每个都出现
    flat += list(rng.choice(chosen, rows * cols - n_codes))
    rng.shuffle(flat)
    grid = [flat[i * cols:(i + 1) * cols] for i in range(rows)]
    return make_sheet(grid, seed=seed, palette=palette, **kw)
