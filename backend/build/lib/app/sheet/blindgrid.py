"""把每个类的字形拼成一张带框线的表，一次读完；再把返回的表拆回来。

一张图纸一个请求，所以并发消耗的是队列位置而不是本机 CPU。

**盲**：格子里只有字形，没有任何我们自己印上去的标注。带标注的版本喂给 OCR 能拿
满分，但那证明不了任何事——它读的是我们写的字。
"""

import math
from html.parser import HTMLParser

import numpy as np
from PIL import Image, ImageDraw
from sklearn.cluster import AgglomerativeClustering

#: 一页最多 16 列 x 16 行。上千块瓦片拼成一张长条，一页错一行、整页答案全部错位；
#: 分页把爆炸半径限制在一页之内，一页读坏了只重读那一页。
MAX_ROW = 16
PER_PAGE = MAX_ROW * MAX_ROW
CELL_W, CELL_H = 300, 150


def columns_for(n: int, max_row: int = MAX_ROW) -> int:
    """这一页排几列——**让页面接近正方**。

    这是打真实接口量出来的，不是设计出来的。同样的内容，只改长宽比：

        4802 x  302 (16 列, 宽高比 15.9)  32 块只回来 16 块，整整一行没了，
                                          而且退化成管道符而不是 HTML 表格
        1802 x  902 (6 列,  宽高比  2.0)  32 块全对
         902 x  602 (6 列,  宽高比  1.5)  32 块全对
        4802 x 2402 (16 列, 宽高比  2.0)  256 块全对，顺序全对
        2402 x 1602 (16 列, 宽高比  1.5)  256 块全对，顺序全对

    决定成败的是长宽比，不是块数：又宽又扁的图被缩到标准宽度后字形就糊没了。
    所以列数取 ceil(sqrt(n))，只在页满时才到 16。
    """
    if n <= 1:
        return 1
    return min(max_row, math.ceil(math.sqrt(n)))

#: 字形向量的归一化距离。实测同色号 p50 0.219，最近的不同色号对 0.228。
#: 宁小勿大：过度拆分只多一块瓦片，合并两个色号会把一个答案盖到两边。
DEDUPE_EPS = 0.20


def dedupe(pics, eps: float = DEDUPE_EPS):
    """字形相同的类折成同一块瓦片。

    颜色的切口故意很紧，所以一个色号常常落在三四个颜色类里——IMG_8422 是 52 个
    色号 110 个类。逐个送等于花钱把同一个字形读好几遍，而且每多一块瓦片就多一次
    表格形状出错的机会。

    返回 `(要送出去的瓦片, 每个类对应哪块瓦片)`。
    """
    pics = list(pics)
    if len(pics) < 2:
        return pics, np.zeros(len(pics), int)
    X = np.array([np.asarray(p, np.float32).ravel() for p in pics])
    X /= np.maximum(np.linalg.norm(X, axis=1, keepdims=True), 1e-6)
    g = AgglomerativeClustering(n_clusters=None, distance_threshold=eps,
                                linkage="complete", metric="euclidean"
                                ).fit_predict(X)
    tiles = []
    for j in range(int(g.max()) + 1):
        members = np.flatnonzero(g == j)
        # 用组自己的中位图，这样一个被毁掉的成员决定不了真正被读的那张图
        tiles.append(np.median(np.stack([pics[i] for i in members]), axis=0))
    return tiles, g


def pages(tiles, per_page: int = PER_PAGE):
    """把瓦片切成若干页，每页最多 per_page 块。

    一张 104x104 的图纸最多分出一千多个颜色类，去重后仍可能有几百块瓦片。拼成
    一张细长的图不但难读，而且**一页只要错一行，那一页之后的答案全部错位**——
    分页把这个爆炸半径限制在一页之内，一页读坏了只重读那一页。
    """
    tiles = list(tiles)
    return [tiles[i:i + per_page] for i in range(0, len(tiles), per_page)] or [[]]


def blind_grid(pics, per_row: int | None = None, cw: int = CELL_W,
               ch: int = CELL_H) -> Image.Image:
    """字形排成一张有真实框线的表，页面上再没有别的东西。

    框线是必须画的：表格模型认的就是它。没有框线，这些瓦片只是散落在页面上的图片，
    回来的顺序由版面分析临时决定。
    """
    pics = list(pics)
    per_row = columns_for(len(pics)) if per_row is None else per_row
    rows = (len(pics) + per_row - 1) // per_row
    img = Image.new("RGB", (per_row * cw + 2, rows * ch + 2), "white")
    d = ImageDraw.Draw(img)
    for i, pic in enumerate(pics):
        x, y = 1 + (i % per_row) * cw, 1 + (i // per_row) * ch
        a = np.asarray(pic, np.float32)
        hi = max(float(np.percentile(a, 99.5)), 1e-6)
        g = np.clip(255 - a / hi * 255, 0, 255).astype(np.uint8)
        tile = Image.fromarray(g).convert("RGB")
        # 在留边的前提下把字形放到格子允许的最大——识别器的全部困难就是这字太小
        k = min((cw - 24) / tile.width, (ch - 24) / tile.height)
        tile = tile.resize((max(1, int(tile.width * k)),
                            max(1, int(tile.height * k))), Image.LANCZOS)
        img.paste(tile, (x + (cw - tile.width) // 2, y + (ch - tile.height) // 2))
    for r in range(rows + 1):
        d.line([(0, r * ch), (img.width, r * ch)], fill=(0, 0, 0), width=2)
    for c in range(per_row + 1):
        d.line([(c * cw, 0), (c * cw, img.height)], fill=(0, 0, 0), width=2)
    return img


class _Table(HTMLParser):
    """HTML 表格的逐行单元格文本，span 展开。

    MinerU 返回的是 HTML `<table>` 而不是管道符 markdown。带 colspan/rowspan 的
    格子说明它合并了邻居——对这张网格来说那就是把框线读错了，会让之后每一个类
    错位一格——所以要展开并检查行宽，而不是假定它对。
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self._row, self._cell, self._in = [], [], [], False
        self._span = 1

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._in, self._cell = True, []
            try:
                self._span = max(1, int(a.get("colspan", 1)))
            except ValueError:
                self._span = 1

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._in:
            self._row.extend(["".join(self._cell).strip()] * self._span)
            self._in, self._span = False, 1
        elif tag == "tr":
            self.rows.append(self._row)

    def handle_data(self, data):
        if self._in:
            self._cell.append(data)


def table_cells(text: str, per_row: int, want: int):
    """按行优先取出单元格文本；形状不对返回 `(None, 原因)`。

    形状不对意味着解析器合并或漏掉了格子，从那一点之后每个答案都属于另一个类。
    所以是拒绝，不是靠猜去重新对齐。
    """
    rows = []
    if "<table" in text:
        p = _Table()
        p.feed(text)
        rows = [r for r in p.rows if r]
    else:
        for line in text.splitlines():
            line = line.strip()
            if "|" not in line:
                continue
            # 实测 MinerU 的管道符行**不带首尾竖线**（"A17 | A18 | ..."）。
            # 只认带首尾竖线的写法会把有效结果判成「没有表」。
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(set(c) <= set("-: ") for c in cells):   # 表头分隔行
                continue
            rows.append(cells)
    if not rows:
        return None, "no table in the output"
    bad = [len(r) for r in rows if len(r) != per_row]
    if bad:
        return None, (f"{len(bad)} row(s) with {sorted(set(bad))} cells, "
                      f"expected {per_row} — alignment cannot be trusted")
    flat = [c for r in rows for c in r]
    if len(flat) < want:
        return None, f"{len(flat)} cells, expected at least {want}"
    return flat[:want], f"ok ({len(rows)} rows x {per_row})"
