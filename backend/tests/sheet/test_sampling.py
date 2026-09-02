"""逐格采样。

两个不变量在这里被钉死：
  1. 填充色取的是**环**，不是整格的众数——小格上一个两位数色号能盖住一半以上
     面积，众数就变成了字的颜色。
  2. 墨迹图**与颜色无关**：同一个字印在深豆和浅豆上，出来的图应该几乎一样。
"""

import numpy as np

from app.colour import load_palette
from app.sheet.sampling import build_glyphs, sample_cells
from tests.sheet.synth import make_random_sheet, make_sheet


def test_fill_is_the_cell_colour_not_the_text_colour():
    """字占了大半个格子时，众数会是字色。环形采样必须给出豆子色。"""
    pal = load_palette("221")
    s = make_sheet([["A1", "H15"], ["B3", "C7"]], pitch=20, font_scale=0.5)
    fill, _ = sample_cells(s.image, s.rect, s.rows, s.cols)
    for i, row in enumerate(s.codes):
        for j, code in enumerate(row):
            want = pal.rgb[pal.codes.index(code)]
            assert np.linalg.norm(fill[i, j].astype(float) - want) < 12, (
                code, fill[i, j], want)


def test_fill_comes_back_as_rgb():
    """下游按 RGB 算 Lab。翻错方向不会崩，只会让所有颜色判断悄悄错掉。"""
    pal = load_palette("221")
    red = max(pal.codes,
              key=lambda c: pal.rgb[pal.codes.index(c)][0]
              - pal.rgb[pal.codes.index(c)][2])
    s = make_sheet([[red]], pitch=40)
    fill, _ = sample_cells(s.image, s.rect, 1, 1)
    assert fill[0, 0][0] > fill[0, 0][2]


def test_inked_is_true_where_a_code_is_printed():
    s = make_random_sheet(rows=6, cols=6, n_codes=3, pitch=27, seed=0)
    _, inked = sample_cells(s.image, s.rect, s.rows, s.cols)
    assert inked.all()


def test_inked_is_false_on_a_blank_cell():
    """空格子和白豆在像素上分不开，所以 has_blanks 要问人；但空白格本身要认得出。"""
    s = make_sheet([["A1", "A1"]], pitch=40)
    x0, y0, _, _ = s.rect
    s.image[int(y0):int(y0) + 40, int(x0) + 40:int(x0) + 80] = 255
    _, inked = sample_cells(s.image, s.rect, 1, 2)
    assert inked[0, 0] and not inked[0, 1]


def test_glyphs_have_one_row_per_cell_and_a_consistent_shape():
    s = make_random_sheet(rows=5, cols=4, n_codes=3, pitch=27, seed=1)
    fill, _ = sample_cells(s.image, s.rect, s.rows, s.cols)
    ink = build_glyphs(s.image, fill, s.rect, s.rows, s.cols)
    assert ink.shape[0] == 20
    assert ink.ndim == 3
    assert ink.dtype == np.float32


def test_the_same_code_on_different_colours_gives_the_same_glyph():
    """墨迹图除掉了填充色，所以字形与豆子颜色无关。

    这是整条 pipeline 能「按颜色分类、按字形识别」的前提：一个色号被颜色抖动裂成
    两个类时，两边的字形仍然可比。
    """
    pal = load_palette("221")
    light = max(pal.codes, key=lambda c: pal.rgb[pal.codes.index(c)].sum())
    dark = min(pal.codes, key=lambda c: pal.rgb[pal.codes.index(c)].sum())
    a = make_sheet([[light]], pitch=40)
    b = make_sheet([[dark]], pitch=40)
    ga = build_glyphs(a.image, sample_cells(a.image, a.rect, 1, 1)[0],
                      a.rect, 1, 1)[0]
    gb = build_glyphs(b.image, sample_cells(b.image, b.rect, 1, 1)[0],
                      b.rect, 1, 1)[0]
    na = ga / max(np.linalg.norm(ga), 1e-6)
    nb = gb / max(np.linalg.norm(gb), 1e-6)
    assert float(np.linalg.norm(na - nb)) < 0.5


def test_a_degenerate_rect_does_not_raise():
    """rows/cols 大到每格不足 3px 时要安静地跳过，不能炸在 web 请求里。"""
    s = make_sheet([["A1"]], pitch=40)
    fill, inked = sample_cells(s.image, s.rect, 200, 200)
    assert fill.shape == (200, 200, 3)
    assert not inked.any()
