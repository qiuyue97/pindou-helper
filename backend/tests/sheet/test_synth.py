"""渲染器自身的测试。

它是后面每一个测试的地基，所以它自己必须先被钉死：画出来的东西要真的在
我们说的位置、真的是我们说的颜色，否则后面所有「通过」都是假的。
"""

import numpy as np

from app.colour import load_palette
from tests.sheet.synth import make_random_sheet, make_sheet


def test_the_rect_lands_exactly_on_the_declared_grid():
    s = make_sheet([["A1", "A2"], ["A3", "A4"]], pitch=30, margin=40)
    assert s.rect == [40.0, 40.0, 100.0, 100.0]
    assert (s.rows, s.cols) == (2, 2)
    assert s.image.shape == (140, 140, 3)


def test_each_cell_carries_its_code_colour():
    """格子四角内侧（避开印上去的字和分隔线）必须是目录色。"""
    pal = load_palette("221")
    s = make_sheet([["A1", "H15"], ["B3", "C7"]], pitch=40, margin=20)
    for i, row in enumerate(s.codes):
        for j, code in enumerate(row):
            want = pal.rgb[pal.codes.index(code)]
            y = int(s.rect[1] + i * 40 + 6)
            x = int(s.rect[0] + j * 40 + 6)
            got = s.image[y, x][::-1].astype(float)  # BGR -> RGB
            assert np.allclose(got, want, atol=1), (i, j, code, got, want)


def test_a_code_is_actually_printed_on_the_cell():
    """格子中央要有墨。没有字的话 OCR 那一段的测试就成了摆设。"""
    s = make_sheet([["A1"]], pitch=40, margin=20)
    pal = load_palette("221")
    fillc = pal.rgb[pal.codes.index("A1")]
    core = s.image[32:48, 32:48][..., ::-1].astype(float)
    assert (np.linalg.norm(core - fillc, axis=-1) > 60).any()


def test_separators_are_drawn_between_cells():
    """分隔线要比两边的格子暗。

    判据是**相对**的：分隔线是半透明叠上去的（真实生成器就是这么画的，交叉点因此
    比两条线都暗，小 pitch 的图纸才检测得到），所以它的绝对灰度取决于底下格子的
    颜色，钉一个绝对阈值只会在换色号时莫名其妙地失败。
    """
    s = make_sheet([["A1", "A2"]], pitch=40, margin=20, sep=(0, 0, 0))
    line = float(s.image[30, 60].mean())      # x=60 是两格之间那条线
    left = float(s.image[30, 45].mean())
    right = float(s.image[30, 75].mean())
    assert line < left - 20 and line < right - 20, (line, left, right)


def test_crossings_are_darker_than_either_line():
    """交叉点必须比横线和竖线都暗——这正是真实图纸的样子，也是小 pitch 还能被
    检测到的原因：竖线的梯度不会在每个交叉点归零，连续段一路贯通。"""
    s = make_sheet([["A1", "A2"], ["A3", "A4"]], pitch=40, margin=20, sep=(0, 0, 0))
    cross = float(s.image[60, 60].mean())
    vert = float(s.image[30, 60].mean())
    horiz = float(s.image[60, 30].mean())
    assert cross < vert and cross < horiz, (cross, vert, horiz)


def test_random_sheets_use_exactly_the_requested_number_of_codes():
    s = make_random_sheet(rows=20, cols=18, n_codes=7, seed=3)
    flat = {c for row in s.codes for c in row}
    assert len(flat) == 7
    assert s.rows == 20 and s.cols == 18


def test_jitter_perturbs_the_fill_without_changing_the_truth():
    """JPEG 噪声的替身：颜色抖一点，色号不变。"""
    a = make_random_sheet(rows=8, cols=8, n_codes=4, seed=1, jitter=0.0)
    b = make_random_sheet(rows=8, cols=8, n_codes=4, seed=1, jitter=1.5)
    assert a.codes == b.codes
    assert not np.array_equal(a.image, b.image)
