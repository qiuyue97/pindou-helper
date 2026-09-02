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


def _blend_line(img, p0, p1, colour, width, alpha=0.75):
    """把一条线**半透明**地叠到图上。

    `cv2.line` 是实心覆盖，两族线颜色相同时交叉点没有梯度。叠加则会在交叉处再压
    暗一次，这正是真实生成器的行为，也是小 pitch 图纸还能被检测到的原因。
    """
    layer = img.copy()
    cv2.line(layer, p0, p1, colour, width)
    touched = (layer != img).any(axis=2)
    img[touched] = (img[touched] * (1 - alpha) + layer[touched] * alpha).astype(np.uint8)


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

    # 分隔线最后画，盖在格子上。**半透明叠加**，不是实心填充——这一点必须照抄
    # 真实生成器，否则整张图在小 pitch 下根本检测不出来：
    #
    # 实心画法下，横竖两条线颜色完全相同，交叉点两侧一模一样，梯度精确为零。于是
    # 竖直分隔线的梯度每隔一个 pitch 就被打断一次，最长连续段只有 pitch-2；
    # _line_maps 的开运算要求 25 像素的连续段，pitch 27 勉强够、20 以下全军覆没。
    #
    # 真实图纸不是这样：量 0968037（pitch 13.4）的像素，格子灰 60、横线 20、
    # 竖线 52，而**交叉点 17，比两条线都暗**——半透明叠加会把交叉处再压暗一次，
    # 梯度因此不为零，连续段一路贯通。
    for j in range(cols + 1):
        x = margin + j * pitch
        _blend_line(img, (x, margin), (x, margin + rows * pitch), sep, sep_w)
    for i in range(rows + 1):
        y = margin + i * pitch
        _blend_line(img, (margin, y), (margin + cols * pitch, y), sep, sep_w)

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
