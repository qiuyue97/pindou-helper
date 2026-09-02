"""盲网格：把所有类的字形拼成一张带框线的表，一次读完。

「盲」的意思是格子里**只有字形，没有任何标注**。实验期那张 _medians.png 会在每块
瓦片下面印出解码结果，拿它去测任何 OCR 都能得满分——读的是我们自己写的字，不是
旁边那个 21px 的字形。

表格解析这一段的原则是**形状不对就拒绝**：MinerU 合并或漏掉一个格子，之后每一个
答案都归属于错误的类，靠猜去对齐只会把错误摊到全表。
"""

import numpy as np

from app.sheet.blindgrid import (
    MAX_ROW,
    PER_PAGE,
    blind_grid,
    columns_for,
    dedupe,
    pages,
    table_cells,
)

HTML = """<table>
<tr><td>A1</td><td>B2</td><td>C3</td></tr>
<tr><td>D4</td><td>E5</td><td>F6</td></tr>
</table>"""


def _glyph(seed, h=30, w=60):
    return np.random.default_rng(seed).random((h, w)).astype(np.float32) * 255


# ---------- 去重 ----------

def test_identical_glyphs_fold_into_one_tile():
    g = _glyph(0)
    tiles, group = dedupe([g, g.copy(), g.copy()])
    assert len(tiles) == 1
    assert list(group) == [0, 0, 0]


def test_different_glyphs_stay_apart():
    tiles, group = dedupe([_glyph(1), _glyph(2), _glyph(3)])
    assert len(tiles) == 3
    assert len(set(group)) == 3


def test_a_single_class_needs_no_clustering():
    tiles, group = dedupe([_glyph(4)])
    assert len(tiles) == 1
    assert list(group) == [0]


def test_the_tile_is_the_group_median_not_a_member():
    """一个被毁掉的成员不能决定送出去读的那张图。"""
    g = _glyph(5)
    bad = g.copy()
    bad[:5] = 255.0
    tiles, _ = dedupe([g, g.copy(), bad], eps=0.9)
    assert len(tiles) == 1
    assert np.allclose(tiles[0], np.median(np.stack([g, g, bad]), axis=0))


# ---------- 拼图 ----------

def test_the_page_is_laid_out_near_square():
    """决定 MinerU 读不读得动的是**长宽比**，不是块数——真实接口量出来的：
    4802x302（宽高比 15.9）丢掉整整一行并退化成管道符；宽高比 1.5-2.0 的
    32/64/100/256 块全部 100% 正确。"""
    for n in (3, 32, 100, PER_PAGE):
        img = blind_grid([_glyph(i) for i in range(n)])
        aspect = img.width / img.height
        assert 0.5 <= aspect <= 3.0, (n, img.size, aspect)


def test_columns_grow_as_the_square_root_and_stop_at_16():
    assert columns_for(1) == 1
    assert columns_for(4) == 2
    assert columns_for(32) == 6
    assert columns_for(100) == 10
    assert columns_for(PER_PAGE) == MAX_ROW
    assert columns_for(9999) == MAX_ROW


def test_an_unwrapped_pipe_row_is_still_a_table():
    """实测 MinerU 的管道符行不带首尾竖线。只认带竖线的写法会把有效结果
    判成「没有表」——第一次真实探针就栽在这里。"""
    cells, why = table_cells("A17 | A18 | A19", per_row=3, want=3)
    assert cells == ["A17", "A18", "A19"], why


# ---------- 分页 ----------

def test_tiles_are_split_into_square_pages():
    """一页最多 16x16。方的规整表格是表格模型最擅长的形状；上千块瓦片拼成一张
    10x122 的细长条，行一多对齐就不可靠，而一页错一行、整页答案就全部错位。"""
    chunks = pages([_glyph(i) for i in range(PER_PAGE + 5)])
    assert [len(c) for c in chunks] == [PER_PAGE, 5]


def test_a_small_class_set_is_a_single_page():
    assert len(pages([_glyph(i) for i in range(7)])) == 1


def test_paging_preserves_order():
    """页内顺序和跨页顺序都必须原样保留——它就是类的顺序。"""
    tiles = list(range(PER_PAGE * 2 + 3))
    assert [t for c in pages(tiles) for t in c] == tiles


def test_a_thousand_classes_is_a_handful_of_pages_not_one_giant_strip():
    """104x104 的图纸最多分出一千多个类。那是 5 页，不是一张 122 行的巨图。"""
    chunks = pages([_glyph(0)] * 1216)
    assert len(chunks) == 5
    assert all(len(c) <= PER_PAGE for c in chunks)


def test_the_grid_carries_no_text_of_our_own():
    """盲网格里只有字形和框线，没有任何我们自己印上去的标注。

    实验期那张 _medians.png 会在每块瓦片下面印出解码结果，拿它去测任何 OCR 都能
    得满分——读的是我们自己写的字，证明不了任何事。

    用**全空白的字形**渲染：如果代码在格子里印了任何东西，它就会显出来。除了
    框线（黑色，宽 2px，只在格子边界上）之外，整张图必须是白的。
    """
    blank = [np.zeros((30, 60), np.float32) for _ in range(5)]
    a = np.asarray(blind_grid(blank).convert("L"))
    per_row = columns_for(5)
    dark = np.argwhere(a < 200)
    for y, x in dark:
        on_v = min(abs(x - c * 300) for c in range(per_row + 1)) <= 2
        on_h = min(abs(y - r * 150) for r in range(3)) <= 2
        assert on_v or on_h, f"({x},{y}) 既不在竖线上也不在横线上——有东西被印上去了"


# ---------- 解析 ----------

def test_html_table_is_parsed_row_major():
    cells, why = table_cells(HTML, per_row=3, want=6)
    assert cells == ["A1", "B2", "C3", "D4", "E5", "F6"]
    assert "ok" in why


def test_colspan_is_expanded():
    """colspan 说明它把两格合并了。展开后行宽才对得上。"""
    html = ('<table><tr><td colspan="2">X</td><td>C3</td></tr>'
            '<tr><td>D4</td><td>E5</td><td>F6</td></tr></table>')
    cells, _ = table_cells(html, per_row=3, want=6)
    assert cells == ["X", "X", "C3", "D4", "E5", "F6"]


def test_a_wrong_shaped_table_is_refused():
    html = "<table><tr><td>A1</td><td>B2</td></tr></table>"
    cells, why = table_cells(html, per_row=3, want=6)
    assert cells is None
    assert "expected 3" in why


def test_too_few_cells_is_refused():
    cells, why = table_cells(HTML, per_row=3, want=9)
    assert cells is None
    assert "at least 9" in why


def test_pipe_markdown_is_accepted_too():
    md = "| A1 | B2 |\n| --- | --- |\n| C3 | D4 |"
    cells, _ = table_cells(md, per_row=2, want=4)
    assert cells == ["A1", "B2", "C3", "D4"]


def test_no_table_at_all_is_refused():
    cells, why = table_cells("just some prose", per_row=3, want=6)
    assert cells is None
    assert "no table" in why
