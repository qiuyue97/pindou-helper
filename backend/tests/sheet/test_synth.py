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
    s = make_sheet([["A1", "A2"]], pitch=40, margin=20, sep=(0, 0, 0))
    # x=60 是两格之间那条线
    assert s.image[30, 60].max() < 40


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
