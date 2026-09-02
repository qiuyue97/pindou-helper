"""把上万格按填充色收敛成几十个类，每类一张「画像」。

一张 104×104 的图纸有 10,816 格，但只有几十个色号。同一张图里，同一个色号的格子
是同一个颜色——这是生成器的性质，不是假设。分好类之后，OCR 的工作量从「每格一次」
降到「每类一次」，降了两到三个数量级。

**颜色只负责分组。** 谁是谁由文字决定：色卡里本来就有几对色号近到任何阈值都分不开
（221 里最近的 G15/H21 在 Lab 上只差 0.96），所以颜色对不上时只举手告警，不推翻
OCR 的读数。
"""

from dataclasses import dataclass

import numpy as np
from sklearn.cluster import AgglomerativeClustering

from app.colour import delta_e00, srgb_to_lab

#: 切在 Lab 上，即 dE76。dE76 会高估饱和色的差异，所以同一个数值在 dE76 下比
#: dE00 下更**紧**——而紧是安全方向：裂开一个类只多一次 OCR，合并两个类是给
#: 那一类里每一格一个错答案。
#:
#: 2.0 是测出来的，不是拍的：三张清晰图上，同一色号自身的颜色散布 p50 1.37-1.52，
#: 一张图**实际用到的**色号里最接近的两个相距 2.67。窗口很窄，取低端。
#:
#: 注意这个 2.67 是「一张图用到的那四十来个色号之间」，不是全色卡：整本 221 里有
#: 7 对不同色号的 Lab 距离小于 2.0，那几对靠颜色分不开，只能靠 OCR。
EPS_LAB = 2.0

#: 参与逐像素中位图的成员上限。再多不会更准，只是更慢。
MEDIAN_CAP = 240


def colour_classes(fill, live, eps: float = EPS_LAB):
    """按填充色做紧的 complete-linkage 分组。

    complete linkage 而不是 DBSCAN：它约束的是类的**直径**，所以没有一串近似颜色
    能把两个真正不同的色号链成一组。买的就是这个性质。

    先把相同的颜色折叠掉——一张图上万格但只有几千种不同颜色，而 linkage 是平方级的。

    返回 `(labels, n)`，labels 长 rows*cols，非 live 的格子是 -1。
    """
    flat = np.asarray(fill).reshape(-1, 3)
    idx = np.flatnonzero(np.asarray(live).reshape(-1))
    out = np.full(len(flat), -1, int)
    if len(idx) == 0:
        return out, 0
    uniq, inv = np.unique(flat[idx], axis=0, return_inverse=True)
    if len(uniq) == 1:
        out[idx] = 0
        return out, 1
    g = AgglomerativeClustering(n_clusters=None, distance_threshold=eps,
                                linkage="complete", metric="euclidean"
                                ).fit_predict(srgb_to_lab(uniq.astype(float)))
    out[idx] = g[inv]
    return out, int(g.max()) + 1


@dataclass
class ClassStat:
    centre_rgb: np.ndarray
    centre_lab: np.ndarray
    order: np.ndarray      # 成员的扁平下标，按离类心由近到远
    radius: float


def class_stats(fill, labels, k: int) -> ClassStat:
    """一个类的类心，以及按离类心距离排好序的成员。

    排序是有用途的：最靠近类心的几个成员就是这个色号「JPEG 损伤最轻的副本」，
    交给 OCR 的就是它们。
    """
    flat = np.asarray(fill).reshape(-1, 3).astype(float)
    m = np.flatnonzero(np.asarray(labels) == k)
    lb = srgb_to_lab(flat[m])
    centre_rgb = flat[m].mean(axis=0)
    centre_lab = srgb_to_lab(centre_rgb)
    d = delta_e00(lb, centre_lab)
    return ClassStat(centre_rgb, centre_lab, m[np.argsort(d)], float(d.max()))


def class_picture(ink, order, cap: int = MEDIAN_CAP) -> np.ndarray:
    """这一类的逐像素中位图。

    中位数对被污染的成员免疫——一个被水印糊掉的成员拉不动它，而均值会。

    build_glyphs 已经把每格按各自的小数偏移重采样过，成员本来就落在同一个亚像素
    栅格上，所以这是真的字形平均，不是各种相位的糊影。
    """
    return np.median(np.asarray(ink)[order[:cap]], axis=0)


def has_colour_structure(n: int, rows: int, cols: int) -> bool:
    """这张图的填充色到底是不是分立的几十个类。

    低分辨率图纸（13px 的格）没有干净的像素留给填充色，水印又让颜色在整张图上缓慢
    漂移。这类图**永远不会出现类数的平台期**：eps 开到 10 仍然裂成 83-179 类。

    读一千个单格类要花半小时，产出一千个不可靠答案。所以不满足就整张走颜色兜底。
    """
    return n <= max(200, 0.15 * rows * cols)
