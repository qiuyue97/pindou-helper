"""盲网格：把所有类的字形拼成一张带框线的表，一次读完。

「盲」的意思是格子里**只有字形，没有任何标注**。实验期那张 _medians.png 会在每块
瓦片下面印出解码结果，拿它去测任何 OCR 都能得满分——读的是我们自己写的字，不是
旁边那个 21px 的字形。

表格解析这一段的原则是**形状不对就拒绝**：MinerU 合并或漏掉一个格子，之后每一个
答案都归属于错误的类，靠猜去对齐只会把错误摊到全表。
"""

import numpy as np

from app.sheet.blindgrid import PER_ROW, blind_grid, dedupe, table_cells

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

def test_the_grid_has_one_row_per_ten_tiles():
    img = blind_grid([_glyph(i) for i in range(23)])
    assert img.height == 3 * 150 + 2
    assert img.width == PER_ROW * 300 + 2


def test_the_grid_carries_no_text_of_our_own():
    """盲网格里只有字形和框线。任何我们自己印上去的字都会让 OCR 的成绩失去意义。

    这里用像素统计当代理：一张只有几个小字形 + 框线的图，非白像素占比必须很低。
    """
    img = blind_grid([_glyph(i) for i in range(5)])
    a = np.asarray(img.convert("L"))
    assert (a < 200).mean() < 0.35


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
