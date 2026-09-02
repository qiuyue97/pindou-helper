"""四个告警级别的触发条件。

核心立场：**不猜**。读不出来就标红交给用户，不产出一个「看起来合理」的答案。

先验（AI 抽取的图例）是关于这张图的一个说法，不是对它的权威：它可以收窄答案空间，
但不能让 OCR 不受限的那个答案消失——两者不一致本身就是要给用户看的东西。
"""

import json

import numpy as np
import pytest

from app.colour import load_palette, srgb_to_lab
from app.sheet.classes import ClassStat
from app.sheet.decide import RANK, WARN_DE, decide

PAL = load_palette("221")


def _stat(code_or_rgb, n=10):
    """按某个色号的目录色（或直接给 RGB）造一个类。"""
    rgb = (PAL.rgb[PAL.codes.index(code_or_rgb)].copy()
           if isinstance(code_or_rgb, str) else np.array(code_or_rgb, float))
    return ClassStat(rgb, srgb_to_lab(rgb), np.arange(n), 1.0)


def test_a_clean_read_is_ok():
    recs = decide([_stat("H15")], ["H15"], PAL)
    assert recs[0].code == "H15"
    assert recs[0].level == "ok"
    assert recs[0].source == "ocr"


def test_an_unreadable_class_is_guessed_and_flagged_red():
    """读不出来 -> 拿类心色配最近的目录色，标红。猜出来的东西必须以猜的身份交付。"""
    recs = decide([_stat("H15")], [None], PAL)
    assert recs[0].source == "guess"
    assert recs[0].level == "guess"
    assert recs[0].code == "H15"          # 颜色恰好就是 H15 的目录色


def test_a_read_far_from_the_catalogue_colour_is_orange():
    """读出 H15，但这一类的颜色离 H15 的目录色很远——读数不被推翻，但要提醒。"""
    far = PAL.rgb[PAL.codes.index("H15")] + np.array([80, -60, 70])
    recs = decide([_stat(np.clip(far, 0, 255))], ["H15"], PAL)
    assert recs[0].code == "H15"          # 文字是主，颜色不推翻它
    assert recs[0].level == "warn"
    assert recs[0].de > WARN_DE


def test_a_read_outside_the_prior_falls_back_to_colour_and_is_red():
    """OCR 读出 A1，图例却说这张图没有 A1——于是没有任何文字依据了，标红。

    为什么是红不是橙：MinerU 每块瓦片只给**一个**答案。原版本地读法有四个变体投票，
    可以在先验内挑次高票，所以还能算「读出来了」；单票引擎下这个答案被先验否掉，
    就没有第二选择，最终色号完全来自颜色。

    橙意味着「有答案，只是颜色可疑」，而这里根本没有文字给出的答案。红才是诚实的。
    不受限的读数记在 read_full 里，用户看得到 OCR 当时认的是什么。
    """
    recs = decide([_stat("H15")], ["A1"], PAL, prior={"H15": 3})
    assert recs[0].read_full == "A1"
    assert recs[0].code == "H15"          # 颜色兜底，限制在先验内
    assert recs[0].source == "guess"
    assert recs[0].off_list is True
    assert recs[0].level == "guess"


def test_the_colour_fallback_is_also_restricted_to_the_prior():
    """猜一个这张图证明没有的色号帮不了任何人。"""
    recs = decide([_stat("H15")], [None], PAL, prior={"A11": 5})
    assert recs[0].source == "guess"
    assert recs[0].code == "A11"


def test_without_a_prior_the_fallback_votes_against_the_whole_catalogue():
    recs = decide([_stat("H15")], [None], PAL, prior=None)
    assert recs[0].code == "H15"


def test_two_classes_of_different_colours_reading_the_same_code_are_orange():
    """一个色号被颜色抖动裂成两类是常态；但两类颜色差很远还读出同一个码，
    说明至少有一个读错了。"""
    a = PAL.rgb[PAL.codes.index("H15")]
    recs = decide([_stat("H15"), _stat(np.clip(a + [90, -70, 60], 0, 255))],
                  ["H15", "H15"], PAL)
    assert all(r.level == "warn" for r in recs)
    assert recs[0].dup is not None and recs[0].dup > WARN_DE


def test_two_classes_of_near_colours_reading_the_same_code_stay_ok():
    """紧切口下同码多类是设计出来的预期结果，不该报警。"""
    a = PAL.rgb[PAL.codes.index("H15")]
    recs = decide([_stat("H15"), _stat(np.clip(a + [1, 1, 1], 0, 255))],
                  ["H15", "H15"], PAL)
    assert all(r.level == "ok" for r in recs)
    assert all(r.dup is None for r in recs)


def test_the_record_serialises_to_plain_json_types():
    """要落进 SQLite 的 JSON 列，不能带 numpy 标量。"""
    d = decide([_stat("H15")], ["H15"], PAL)[0].as_dict()
    json.dumps(d)                                     # 不能抛
    assert isinstance(d["rgb"], list)
    assert all(isinstance(v, int) for v in d["rgb"])
    assert isinstance(d["n"], int)
    assert isinstance(d["de"], float)
    assert all(isinstance(v, int) for v in d["cells"])


@pytest.mark.parametrize("level", ["ok", "warn", "count", "guess"])
def test_every_level_has_a_rank(level):
    assert level in RANK
