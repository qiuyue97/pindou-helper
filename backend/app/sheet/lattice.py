"""从画出来的分隔线里找出点阵：pitch、相位，以及它到哪儿为止。

三个阶段，没有一个认识某个特定生成器的家具（标尺、坐标框、页脚）：

  1  线图    用线性核做开运算。分隔线能活下来是因为它横跨整张图；一笔字、一个
             爱心图标、一道斜水印在任何一个轴上都没有那么长的连续段，被抹掉。
  2  pitch   把每个位置按候选 pitch 折叠成单位向量再求和，衡量这个 pitch 对**全部**
             位置的解释力。比众数间隔强的地方在于：它不在乎有些分隔线根本没画
             （相邻同色时看不见），也不在乎混进来几条多余的边。
  3  extent  二维共现。一条带属于点阵，当且仅当**另一个轴**的分隔线真的穿过它。
             这一条同时干掉了一维密度判据的两种失败：自身分隔线褪掉的行照样得分
             （竖线贯穿整个网格高度），而图例里的横线不管画得多像，都没有列间距
             的竖线穿过它。

产出只是**初始猜测**。用户会在界面上确认，所以宁可给一个偏大的框（容易往里收），
也不要给一个看着很像但其实错了的。
"""

from dataclasses import dataclass, field

import cv2
import numpy as np


@dataclass
class Guess:
    rect: list[float]
    rows: int
    cols: int
    snap_x: list[float] = field(default_factory=list)
    snap_y: list[float] = field(default_factory=list)
    source: str = ""


def _line_maps(gray, length=25, thresh=40):
    """属于长直线段的边缘像素，按方向分开。

    用线性核做开运算是「只保留连着边界的边缘」的廉价形式：分隔线能活下来是因为
    它横跨整张图，而一笔字、一个图标、一道斜水印在任一轴上都没有那么长的连续段。
    """
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, 3))
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, 3))
    vert = cv2.morphologyEx((gx > thresh).astype(np.uint8), cv2.MORPH_OPEN,
                            np.ones((length, 1), np.uint8))
    horiz = cv2.morphologyEx((gy > thresh).astype(np.uint8), cv2.MORPH_OPEN,
                             np.ones((1, length), np.uint8))
    return vert, horiz


def _ridges(prof, thresh):
    """一维剖面上每个超过阈值的连续段，取中点。"""
    out, s = [], None
    for i, v in enumerate(prof > thresh):
        if v and s is None:
            s = i
        elif not v and s is not None:
            out.append((s + i - 1) / 2)
            s = None
    if s is not None:
        out.append((s + len(prof) - 1) / 2)
    return np.array(out)


def _pitch_of(pos, lo=6.0, hi=90.0, step=0.02, floor=0.72):
    """相位相干性给出的 pitch。

    把每个位置按候选 pitch 折叠成单位向量再求和，衡量这个 pitch 对**全部**位置的
    解释力。它不在乎有些分隔线根本没画，也不在乎混进来几条多余的边。

    真 pitch 的一半得分一样高（每个位置照样落在格点上），所以在合格的候选里取
    **最大**的那个。
    """
    if len(pos) < 6:
        return None
    ps = np.arange(lo, hi, step)
    coh = np.abs(np.exp(2j * np.pi * pos[None, :] / ps[:, None]).mean(axis=1))
    ok = np.where(coh > floor)[0]
    if len(ok) == 0:
        return None
    # 从最大的合格候选往上走到局部峰，让基频赢过它的分频
    i = ok[-1]
    while i + 1 < len(coh) and coh[i + 1] >= coh[i]:
        i += 1
    lo_i = max(0, i - 40)
    return float(ps[lo_i + int(coh[lo_i:i + 41].argmax())])


def _merge(pos, tol):
    out = []
    for p in pos:
        if out and p - out[-1][-1] <= tol:
            out[-1].append(p)
        else:
            out.append([p])
    return np.array([float(np.mean(g)) for g in out])


def _fit(pos, pitch):
    """最小二乘拟合格点，容忍从没画出来的分隔线。"""
    k = np.round((pos - pos[0]) / pitch)
    A = np.vstack([k, np.ones(len(k))]).T
    sol, *_ = np.linalg.lstsq(A, pos, rcond=None)
    for _ in range(3):
        good = np.abs(A @ sol - pos) < pitch * 0.3
        if good.sum() < 4:
            break
        sol, *_ = np.linalg.lstsq(A[good], pos[good], rcond=None)
    good = np.abs(A @ sol - pos) < pitch * 0.3
    return float(sol[0]), float(sol[1]), good


def _fit_axis(prof, thresh=0.3):
    """一个轴的 pitch 和相位。**不返回 extent**——那是二维问题。"""
    pos = _ridges(prof, thresh)
    if len(pos) < 6:
        return None
    p0 = _pitch_of(pos)
    if not p0:
        return None
    # 只合并「一条画出来的线可能产生的东西」。按 pitch 比例放宽会让相距 12px 的两条
    # 真线塌成中间一条幻影，图例的横线就是这么冒充成分隔线的。
    pos = _merge(pos, min(5.0, p0 * 0.3))
    # 合并后重估：第一遍看到的是每条线两个边缘造成的「2px-空-2px-空」，把间隔
    # 严重拉低了。
    p0 = _pitch_of(pos) or p0
    pitch, phase, good = _fit(pos, p0)
    return {"pitch": pitch, "phase": phase, "support": float(good.mean()),
            "found": len(pos), "ridges": pos}


def _extent(vert, horiz, ax, ay, thresh=0.30, gap=1):
    """二维共现定界。返回 ((x0,x1,ncols), (y0,y1,nrows)) 或 None。

    一条带属于点阵，当且仅当**另一个轴**的分隔线真的穿过它：

        行带得分 = 有竖直边缘落在带内的列线占比
        列带得分 = 有水平边缘落在带内的行线占比

    一维密度判据的两种失败在这里同时消失：自身分隔线褪掉的行（相邻深色格）照样
    得分高，因为竖线贯穿整个网格高度；而图例里的横线不管排得多像点阵，都没有列
    间距的竖线穿过它，得分接近零。

    阈值必须明显低于「真网格里一片单色区域」的得分（实测 0.42：那里自己没有分隔
    线），又明显高于图例/标题带（实测最高 0.15）。

    一条边都不穿过的线（网格之外）从分母里剔掉，免得页边把真带稀释到阈值以下。
    """
    H, W = vert.shape
    px, py = ax["pitch"], ay["pitch"]

    def lattice(phase, pitch, n):
        k0 = int(np.ceil(-phase / pitch)) - 1
        k1 = int(np.floor((n - 1 - phase) / pitch)) + 1
        return phase + np.arange(k0, k1 + 1) * pitch

    xl, yl = lattice(ax["phase"], px, W), lattice(ay["phase"], py, H)
    if len(xl) < 3 or len(yl) < 3:
        return None

    # 分隔线宽 2-3px 而拟合是亚像素的，允许偏离标称位置五分之一个 pitch
    tx, ty = max(2.0, px * 0.2), max(2.0, py * 0.2)
    near_x = np.zeros((len(xl), H), bool)
    for j, x in enumerate(xl):
        a, b = max(0, round(x - tx)), min(W, round(x + tx + 1))
        if b > a:
            near_x[j] = vert[:, a:b].any(axis=1)
    near_y = np.zeros((len(yl), W), bool)
    for i, y in enumerate(yl):
        a, b = max(0, round(y - ty)), min(H, round(y + ty + 1))
        if b > a:
            near_y[i] = horiz[a:b, :].any(axis=0)

    act_x, act_y = near_x.any(axis=1), near_y.any(axis=1)
    if not act_x.any() or not act_y.any():
        return None

    def band_scores(near, active, lines, cap):
        s = np.zeros(max(0, len(lines) - 1))
        for k in range(len(s)):
            a, b = round(lines[k]), round(lines[k + 1])
            b = min(max(b, a + 1), cap)
            a = max(0, a)
            if b > a:
                s[k] = near[active, a:b].any(axis=1).mean()
        return s

    row_s = band_scores(near_x, act_x, yl, H)
    col_s = band_scores(near_y, act_y, xl, W)

    def pick(scores, lines):
        """得分合格的最长连续段，允许桥接至多 gap 条不合格的。

        一条横贯全宽的单色条纹画不出分隔线，不桥接的话会把网格拦腰截断。
        """
        ok = scores >= thresh
        runs, k = [], 0
        while k < len(ok):
            if not ok[k]:
                k += 1
                continue
            e, miss, m = k, 0, k + 1
            while m < len(ok):
                if ok[m]:
                    e, m, miss = m, m + 1, 0
                elif miss < gap:
                    miss, m = miss + 1, m + 1
                else:
                    break
            runs.append((k, e))
            k = m
        if not runs:
            return None
        a, b = max(runs, key=lambda r: r[1] - r[0])
        return float(lines[a]), float(lines[b + 1]), int(b - a + 1)

    rx, ry = pick(col_s, xl), pick(row_s, yl)
    return (rx, ry) if rx and ry else None


def _longest_run(flags, gap=1):
    """最长的一段 True，允许桥接至多 gap 个 False。返回 (起, 止) 闭区间或 None。"""
    best, k = None, 0
    while k < len(flags):
        if not flags[k]:
            k += 1
            continue
        e, miss, m = k, 0, k + 1
        while m < len(flags):
            if flags[m]:
                e, m, miss = m, m + 1, 0
            elif miss < gap:
                miss, m = miss + 1, m + 1
            else:
                break
        if best is None or e - k > best[1] - best[0]:
            best = (k, e)
        k = m
    return best


def pattern(fill, inked, ink=0.9, light_frac=0.85, light=190, gap=1,
            min_frac=0.5):
    """点阵里真正是画面的那一块，返回 (行区间, 列区间) 或 None。

    `_extent` 定的是**点阵**的边界，而点阵通常比画面大一圈：标尺、坐标框、页脚、
    图例的分隔线和豆阵的是连着的，几何上分不开。所以还得按**内容**再收一次。

    两条判据：

      有字   豆子格一定印着它的色号，所以一条真画面带几乎每格都有墨。标题横幅、
             图例表头也有字，但很稀疏（纯底色上几个字、隔一格一个色块），过不了
             这个阈值。
      不淡   家具带（标尺、坐标框、空白填充）是单一浅色：即使印上的数字扰动了环
             形采样，逐格自身的均值仍然是淡的，所以「淡格占比」接近 1。画面则是
             饱和或深的，实测淡格占比从没超过 0.54，而每条家具带都在 0.9 以上。

    先试过用「平坦度」判：不行。一条坐标数字带并不平坦——数字把环形采样扰动到只有
    约 44% 的格子落在中位数 ±12 内，所以平坦度分不开它和画面。淡格占比可以，
    因为每个坐标格**平均**下来仍然是淡的。

    连续段允许桥接一条非画面带，这样一行发白的豆子（色号几乎读不出来）不会把画面
    拦腰截断。

    ---

    **`min_frac`：算出来的画面块小于点阵的这个比例，就当作没找到。**

    上面两条判据各有一种会整片失效的情形，实测 13 张人工确认的图纸：

      有空白格   「豆子格一定印着色号」不成立。4 张有空格的图全部灾难性出错，
                 偏差 632 / 906 / 1502 / 3328 px。
      画面本身淡  D63E4322 的背景色 H2 占了 2961 颗且很浅，整片外围行被当成家具
                 丢掉，65x65 收成 20x24，偏差 2689 px。

    这两种情形下失效的不是某个阈值，而是判据的前提，所以调 ink / light 救不了。
    但它们有一个共同的、可观测的后果：切出来的块小得离谱。实测面积占比在
    83.8% 和 42.1% 之间有 42 个百分点的空当，空当之上 6 好 1 坏，空当之下 6 张全坏。

    0.5 取在空当正中，它不是调出来的阈值而是一句定义：如果你认定的「画面块」还不到
    你检测出的点阵的一半，那你几乎肯定是切进画面里了，而不是修掉了家具。

    这时返回 None，调用方退回整个点阵——那是诚实的答案。整个点阵最差也只差
    156 px（通常 15-105），而且**永远是偏大**，用户往里收一下就行；一个错的小框
    会骗过人眼，那才是真正的坏结果。
    """
    fill = np.asarray(fill)
    inked = np.asarray(inked)

    def content(strip_fill, strip_inked):
        sf = strip_fill.astype(float)
        if len(sf) < 3 or float(np.asarray(strip_inked).mean()) < ink:
            return False
        return float((sf.mean(axis=1) > light).mean()) <= light_frac

    rows = [content(fill[i], inked[i]) for i in range(fill.shape[0])]
    cols = [content(fill[:, j], inked[:, j]) for j in range(fill.shape[1])]
    rr, cc = _longest_run(rows, gap), _longest_run(cols, gap)
    if not rr or not cc:
        return None
    nr, nc = rr[1] - rr[0] + 1, cc[1] - cc[0] + 1
    if nr * nc < min_frac * fill.shape[0] * fill.shape[1]:
        return None                       # 见上：小得离谱就是切进画面了
    return (rr[0], rr[1] + 1), (cc[0], cc[1] + 1)


def detect(im: np.ndarray, length: int = 25, thresh: int = 40,
           ridge: float = 0.3, co: float = 0.30, gap: int = 1) -> Guess | None:
    """初始猜测 + 吸附靶点。找不到点阵返回 None，不抛异常。

    两步：`_extent` 用几何定出点阵的边界，`pattern` 再按内容把它收窄到画面块。
    只做第一步的话，框会一律偏大——标尺和图例的分隔线跟豆阵是连着的，几何分不开
    它们（实测真图 49x48 会给成 54x52）。

    `pattern` 什么都没找到时退回整个点阵，那是诚实的答案：框大了用户往里收很容易，
    而一个看着很像却错了的框会骗过人眼。
    """
    from app.sheet.sampling import sample_cells  # 避免模块级循环导入

    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    vert, horiz = _line_maps(gray, length, thresh)
    ax = _fit_axis(vert.mean(axis=0), ridge)
    ay = _fit_axis(horiz.mean(axis=1), ridge)
    if not ax or not ay:
        return None
    ext = _extent(vert, horiz, ax, ay, co, gap)
    if not ext:
        return None
    (x0, x1, ncols), (y0, y1, nrows) = ext

    # 点阵本身就是一个被均分的矩形，所以这里能直接复用下游那个采样器，不需要
    # 另写一份「按 pitch/phase 采样」的代码。
    if nrows >= 3 and ncols >= 3:
        fill, inked = sample_cells(im, [x0, y0, x1, y1], nrows, ncols)
        rc = pattern(fill, inked)
        if rc is not None:
            (r0, r1), (c0, c1) = rc
            px, py = (x1 - x0) / ncols, (y1 - y0) / nrows
            x0, x1 = x0 + c0 * px, x0 + c1 * px
            y0, y1 = y0 + r0 * py, y0 + r1 * py
            nrows, ncols = r1 - r0, c1 - c0

    return Guess(
        rect=[x0, y0, x1, y1], rows=nrows, cols=ncols,
        # 吸附靶点是**真实检测到的**分隔线，不是拟合出来的格点：用户拖到一条真线上
        # 才该吸住，拖到一条推算出来但图上没有的线上不该。
        snap_x=[float(v) for v in ax["ridges"]],
        snap_y=[float(v) for v in ay["ridges"]],
        source="lattice",
    )
