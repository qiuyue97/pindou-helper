"""照片 → 拼豆图纸。

这里全是**可判定**的性质，不是「看起来好不好」：一条竖着的红蓝分界线，缩到
豆阵之后仍然是一条竖着的红蓝分界线，中间不该冒出紫色。平均法过不了这一关，
那正是它不能用的原因。
"""

import numpy as np
import pytest

from app.colour import load_palette, srgb_to_lab
from app.sheet.generate import (
    despeckle,
    dpid,
    generate,
    grid_slic,
    saturate,
    to_palette,
)

PAL = load_palette("291")


def half_and_half(h=120, w=120, left=(220, 30, 30), right=(30, 60, 200), cut=None):
    """左红右蓝。`cut` 是分界线的列号，默认正中。"""
    im = np.zeros((h, w, 3), np.uint8)
    x = w // 2 if cut is None else cut
    im[:, :x] = left
    im[:, x:] = right
    return im


def codes_of(idx):
    return np.array(PAL.codes, dtype=object)[idx]


def codes_from(im, rows, cols, down):
    """直接对**原尺寸**跑降采样再配色卡，绕开 generate 里的预缩放。

    预缩放会把边界糊到相邻像素上，于是「边界落在一格的百分之几处」这个前提就不
    成立了——而下面几条测的正是那个百分比。端到端的行为由 generate 那几条覆盖。
    """
    lab = srgb_to_lab(im).astype(np.float32)
    idx, _de = to_palette(saturate(down(lab, rows, cols)), PAL)
    return codes_of(idx)


# ---------------------------------------------------------------- 分界线 --


def test_slic_keeps_a_hard_edge_hard():
    """一格跨在边界上时，平均值是两边都不存在的颜色——配色卡之后就是个「谁都
    不像」的第三个豆号。网格约束的 SLIC 让格子边界挪过去，整格归多数那一侧。

    分界线放在某一格的 70% 处（不是 50/50 的平局——真平局时任何单一颜色都是
    妥协，那一格本来就没有正确答案）。
    """
    # 12 格 x 10 像素；分界线落在第 5 格的 70% 处
    got = codes_from(half_and_half(60, 120, cut=57), 6, 12, grid_slic)
    for row in got:
        assert len(set(row)) == 2, f"边界上冒出了中间色：{list(row)}"


def test_slic_snaps_the_straddling_cell_to_the_majority_side():
    """跨界那一格 70% 是左边的颜色，就该整格算左边的。"""
    got = codes_from(half_and_half(60, 120, cut=57), 6, 12, grid_slic)
    assert got[0, 5] == got[0, 0]


def test_dpid_leaves_at_most_one_transitional_column():
    """DPID 在**边界**上不如 SLIC——它强调偏离局部均值的像素，跨界那一格于是
    落在两色中间。这是它的固有代价，换来的是小细节不被洗掉（下面那条）。
    这里只钉住「糊的范围不会扩散」：最多一列。
    """
    idx, _de, _lab = generate(half_and_half(60, 120, cut=57), 6, 12, PAL,
                              style="dpid", clean=False)
    got = codes_of(idx)
    ends = {got[0, 0], got[0, -1]}
    assert sum(1 for c in got[0] if c not in ends) <= 1


@pytest.mark.parametrize("style", ["slic", "dpid"])
def test_the_edge_lands_where_it_should(style):
    """左半边全是一个色号，右半边全是另一个，界在中间。"""
    idx, _de, _lab = generate(half_and_half(), 6, 8, PAL, style=style, clean=False)
    got = codes_of(idx)
    assert len(set(got[:, :4].reshape(-1))) == 1
    assert len(set(got[:, 4:].reshape(-1))) == 1
    assert got[0, 0] != got[0, -1]


@pytest.mark.parametrize("style", ["slic", "dpid"])
def test_a_flat_image_gives_one_colour(style):
    im = np.full((100, 100, 3), (200, 120, 40), np.uint8)
    idx, _de, _lab = generate(im, 10, 10, PAL, style=style, clean=False)
    assert len(set(codes_of(idx).reshape(-1))) == 1


@pytest.mark.parametrize("style", ["slic", "dpid"])
def test_the_output_is_exactly_the_asked_for_grid(style):
    idx, de, lab = generate(half_and_half(200, 300), 17, 23, PAL, style=style)
    assert idx.shape == (17, 23)
    assert de.shape == (17, 23)
    assert lab.shape == (17, 23, 3)


def test_a_silly_grid_is_refused():
    with pytest.raises(ValueError):
        generate(half_and_half(), 0, 10, PAL)


def test_an_unknown_style_is_refused():
    with pytest.raises(ValueError, match="生成方式"):
        generate(half_and_half(), 4, 4, PAL, style="magic")


# ------------------------------------------------------------ 降采样本身 --


def test_slic_beats_area_mean_on_an_off_centre_edge():
    """边界落在一格的 30% 处：平均法给出 70 的灰，SLIC 整格归白。

    这就是「网格约束」的全部价值——格子边界能挪到轮廓上去。边界正好落在 50%
    时三种方法都给 50，那不是缺陷：那一格真的一半一半，没有更好的答案。
    """
    from app.sheet.generate import _area_mean

    im = np.zeros((60, 120, 3), np.uint8)
    im[:, 53:] = 255                      # 第 5 格（50..60）的 30% 处
    lab = srgb_to_lab(im)
    assert grid_slic(lab, 6, 12)[3, 5, 0] == pytest.approx(100, abs=1)
    assert _area_mean(lab, 6, 12)[3, 5, 0] == pytest.approx(70, abs=3)


def test_a_true_tie_still_commits_to_one_side():
    """边界正好在格子中线上时，那一格一半一半——两边都对，但**不能给个中间色**。

    贴豆要的是干净的边：宁可整格归左或整格归右，也不要一颗「谁都不像」的豆子
    横在中间。哪一边由迭代顺序定死，是稳定的。
    """
    im = np.zeros((60, 120, 3), np.uint8)
    im[:, 55:] = 255
    got = codes_from(im, 6, 12, grid_slic)
    assert got[3, 5] in (got[3, 0], got[3, -1])


def test_dpid_keeps_a_detail_that_area_mean_washes_out():
    """一格里只有几个像素是亮点：平均法把它摊没了，DPID 该把它留住。"""
    im = np.zeros((60, 60, 3), np.uint8)
    im[28:32, 28:32] = 255                    # 一小块白，正好在中间那一格里
    lab = srgb_to_lab(im)

    from app.sheet.generate import _area_mean

    assert dpid(lab, 6, 6)[3, 3, 0] > _area_mean(lab, 6, 6)[3, 3, 0]


def test_cells_are_split_evenly_even_when_it_does_not_divide():
    """1075 像素分 100 格，按整数步长走的话最后一格只剩 5 个像素——那一排的
    颜色全是错的。均分不会这样。"""
    from app.sheet.generate import _cell_bounds

    b = _cell_bounds(100, 1075)
    widths = np.diff(b)
    assert widths.min() >= 10 and widths.max() <= 11
    assert b[0] == 0 and b[-1] == 1075


# ---------------------------------------------------------------- 配色卡 --


def test_pure_black_and_white_land_on_sane_codes():
    lab = srgb_to_lab(np.array([[[0, 0, 0], [255, 255, 255]]], np.uint8))
    idx, de = to_palette(lab, PAL)
    assert de.max() < 6          # 色卡里黑白都有，不该差很远
    assert PAL.codes[idx[0, 0]] != PAL.codes[idx[0, 1]]


def test_the_distance_to_the_chosen_bead_is_reported():
    """dE 大 = 这个颜色拼豆里根本没有。要报出来，不能默默配一个凑合的。"""
    lab = srgb_to_lab(np.array([[[0, 255, 130]]], np.uint8))   # 极亮的荧光绿
    _idx, de = to_palette(lab, PAL)
    assert de[0, 0] > 0


def test_saturation_only_touches_chroma():
    lab = np.array([[[50.0, 10.0, -20.0]]])
    out = saturate(lab, 1.2)
    assert out[0, 0, 0] == 50.0                 # L 不动，动了整张图会冲白
    assert out[0, 0, 1] == pytest.approx(12.0)
    assert out[0, 0, 2] == pytest.approx(-24.0)


# ---------------------------------------------------------------- 去孤点 --


def test_an_isolated_bead_is_absorbed():
    a = np.zeros((5, 5), int)
    a[2, 2] = 7
    assert despeckle(a)[2, 2] == 0


def test_a_pair_is_not_a_speck():
    """两颗挨着就不是噪点了，是用户能看出来的细节，不许动。"""
    a = np.zeros((5, 5), int)
    a[2, 2] = a[2, 3] = 7
    out = despeckle(a)
    assert out[2, 2] == 7 and out[2, 3] == 7


def test_a_tie_is_left_alone():
    """周围两种颜色一样多时不猜——猜错的代价是画面上凭空多一颗别的豆子。"""
    a = np.array([[1, 1, 1], [2, 9, 1], [2, 2, 2]])
    # 8 邻域里 1 和 2 各四个
    assert despeckle(a)[1, 1] == 9


def test_despeckle_is_optional():
    # 一小块白**整个落在一格里**（第 2 行第 2 列，跨 20..30），于是它是孤点
    im = np.full((60, 60, 3), (10, 10, 10), np.uint8)
    im[22:28, 22:28] = (240, 240, 240)
    kept, _de, _lab = generate(im, 6, 6, PAL, style="dpid", clean=False)
    cleaned, _de2, _lab2 = generate(im, 6, 6, PAL, style="dpid", clean=True)
    assert len(set(kept.reshape(-1).tolist())) == 2
    assert len(set(cleaned.reshape(-1).tolist())) == 1


# ------------------------------------------------------------------ 进度 --


def test_progress_is_reported():
    seen = []
    generate(half_and_half(), 6, 6, PAL, style="dpid", on_step=lambda t, p: seen.append((t, p)))
    assert seen and seen[0][1] < seen[-1][1]
    assert all(0 <= p <= 100 for _t, p in seen)
