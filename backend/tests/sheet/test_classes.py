"""颜色聚类。

切口**故意偏紧**：把一个色号裂成两类，代价是多做一次 OCR；把两个色号并成一类，
代价是输给那一类里每一个格子一个错答案。两个代价不对称，所以宁可裂。

用 complete linkage 而不是 DBSCAN，因为它约束的是类的**直径**——DBSCAN 允许链式
蔓延，一串中间色能把两个本该分开的色号连成一片。
"""

import numpy as np

from app.colour import load_palette, srgb_to_lab
from app.sheet.classes import (
    EPS_LAB,
    class_picture,
    class_stats,
    colour_classes,
    has_colour_structure,
)
from app.sheet.sampling import build_glyphs, sample_cells
from tests.sheet.synth import make_random_sheet, make_sheet


def _live_all(inked):
    return np.ones_like(inked)


def _separation(a: str, b: str) -> float:
    """两个色号在 Lab 里的欧氏距离，也就是切口用的那个度量。"""
    pal = load_palette("221")
    la = pal.lab[pal.codes.index(a)]
    lb = pal.lab[pal.codes.index(b)]
    return float(np.linalg.norm(la - lb))


def test_cells_of_one_code_land_in_one_class():
    s = make_random_sheet(rows=20, cols=20, n_codes=6, pitch=27, seed=0)
    fill, inked = sample_cells(s.image, s.rect, s.rows, s.cols)
    lab, n = colour_classes(fill, _live_all(inked))
    truth = [c for row in s.codes for c in row]
    for code in set(truth):
        got = {lab[i] for i, c in enumerate(truth) if c == code}
        assert len(got) == 1, f"{code} 裂成了 {len(got)} 类"
    assert n == 6


def test_two_codes_further_apart_than_eps_are_never_merged():
    """间距明显大于切口的两个色号必须分开。合并就是给整类一个错答案。"""
    a, b = "A1", "H15"
    assert _separation(a, b) > EPS_LAB * 3, "这一对没有拉开，换一对再断言"
    s = make_sheet([[a, b] * 5] * 6, pitch=27)
    fill, inked = sample_cells(s.image, s.rect, s.rows, s.cols)
    lab, n = colour_classes(fill, _live_all(inked))
    assert n >= 2
    assert lab[0] != lab[1]


def test_codes_closer_than_eps_do_merge_and_that_is_why_ocr_is_primary():
    """比切口还近的两个色号**分不开**——这是已知边界，不是缺陷。

    221 色卡里有 7 对不同色号的 Lab 距离小于 2.0，最近的 G15/H21 只差 0.96。
    没有任何颜色阈值能把它们分开：把切口收到 0.9 以下，同一个色号自身的抖动
    （实测 p50 1.37-1.52）就会把每张图炸成上千个单格类。

    所以颜色只负责分组、缩小 OCR 的工作量；**谁是谁由文字决定**，颜色对不上时
    只举手告警，不推翻读数。这条测试就是把那个前提钉住。
    """
    a, b = "G15", "H21"
    assert _separation(a, b) < EPS_LAB
    s = make_sheet([[a, b] * 5] * 6, pitch=27)
    fill, inked = sample_cells(s.image, s.rect, s.rows, s.cols)
    lab, _ = colour_classes(fill, _live_all(inked))
    assert lab[0] == lab[1], "这一对居然分开了——去确认 EPS_LAB 是不是被改小了"


def test_no_class_ever_mixes_two_codes():
    """同一色号被噪声裂成两类可以接受；一个类里混进两个色号不行。"""
    s = make_random_sheet(rows=24, cols=24, n_codes=8, pitch=27, seed=2, jitter=1.2)
    fill, inked = sample_cells(s.image, s.rect, s.rows, s.cols)
    lab, n = colour_classes(fill, _live_all(inked))
    truth = [c for row in s.codes for c in row]
    for k in range(n):
        members = {truth[i] for i in np.flatnonzero(lab == k)}
        assert len(members) == 1, f"第 {k} 类混了 {members}"


def test_blank_cells_get_label_minus_one():
    s = make_random_sheet(rows=6, cols=6, n_codes=3, pitch=27, seed=3)
    fill, inked = sample_cells(s.image, s.rect, s.rows, s.cols)
    live = inked.copy()
    live[0, 0] = False
    lab, _ = colour_classes(fill, live)
    assert lab[0] == -1
    assert (lab[1:] >= 0).all()


def test_a_single_colour_sheet_is_one_class():
    s = make_sheet([["A1"] * 4] * 4, pitch=27)
    fill, inked = sample_cells(s.image, s.rect, s.rows, s.cols)
    lab, n = colour_classes(fill, _live_all(inked))
    assert n == 1
    assert (lab == 0).all()


def test_class_stats_orders_members_by_distance_from_the_centre():
    s = make_random_sheet(rows=10, cols=10, n_codes=4, pitch=27, seed=4, jitter=1.0)
    fill, inked = sample_cells(s.image, s.rect, s.rows, s.cols)
    lab, _ = colour_classes(fill, _live_all(inked))
    st = class_stats(fill, lab, 0)
    from app.colour import delta_e00

    flat = srgb_to_lab(fill.reshape(-1, 3).astype(float))
    d = delta_e00(flat[st.order], st.centre_lab)
    assert (np.diff(d) >= -1e-9).all(), "order 必须按离类心的距离升序"
    assert st.radius == float(d.max())


def test_class_picture_is_immune_to_one_ruined_member():
    """逐像素中位数：一个被毁掉的成员拉不动它，均值会。"""
    s = make_random_sheet(rows=10, cols=10, n_codes=2, pitch=27, seed=5)
    fill, inked = sample_cells(s.image, s.rect, s.rows, s.cols)
    ink = build_glyphs(s.image, fill, s.rect, s.rows, s.cols)
    lab, _ = colour_classes(fill, _live_all(inked))
    order = class_stats(fill, lab, 0).order
    clean = class_picture(ink, order)
    ink[order[-1]] = 255.0                       # 毁掉离类心最远的那个
    assert np.allclose(clean, class_picture(ink, order), atol=1e-6)


def test_the_no_structure_guard():
    """类数远超色号数就说明根本没有类，只有一段被任意切开的连续谱。"""
    assert has_colour_structure(52, 49, 48)
    assert has_colour_structure(200, 104, 104)
    assert not has_colour_structure(3000, 104, 104)
    # 小图的下限是绝对值 200，不是比例——不然 10x10 的图 16 个类就被判死刑
    assert has_colour_structure(60, 10, 10)


def test_eps_is_the_measured_value():
    """2.0 是测出来的：同色号自身散布 p50 1.37-1.52，一张图里最近的两个色号 2.67。"""
    assert EPS_LAB == 2.0
