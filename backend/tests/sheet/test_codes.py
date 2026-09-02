"""OCR 原始串 → 合法色号。

这个模块存在的唯一理由是**拒绝**：两种修复都成立时，说明真的分不清，猜一个就是
把「我看不出来」变成了一个自信的错答案。整条 pipeline 的红色告警就是为了避免这个。
"""

import pytest

from app.sheet.codes import candidates, coerce, normalise

VALID = {"A1", "A11", "B8", "H15", "H20", "C6", "M3"}


@pytest.mark.parametrize(("raw", "want"), [
    ("H15", "H15"),
    (" h15 ", "H15"),
    ("H-15", "H15"),
    ("H 1 5", "H15"),
    ("", ""),
    (None, ""),
])
def test_normalise(raw, want):
    assert normalise(raw) == want


def test_an_exact_code_is_returned_as_is():
    assert candidates("H15", VALID) == ["H15"]


def test_a_single_repair_is_accepted():
    """尾部的 B 只可能是 8，只有一解。"""
    assert candidates("BB", VALID) == ["B8"]


def test_a_repair_that_lands_outside_the_catalogue_is_refused():
    """815 修成 B15，色卡里没有，就什么都不返回。"""
    assert candidates("815", VALID) == []


def test_an_ambiguous_repair_is_refused():
    """0 在首位可能是 O/D/Q。两个都合法时必须弃权。"""
    assert candidates("01", {"D1", "O1"}) == []


def test_nothing_plausible_returns_nothing():
    assert candidates("ZZZZ", VALID) == []
    assert candidates("", VALID) == []
    assert candidates(None, VALID) == []


def test_a_leading_digit_can_become_a_letter():
    """首位一定是字母，所以首位的数字必须被翻译过去。"""
    assert coerce("41") == ["A1"]
    assert set(coerce("61")) == {"G1", "C1"}


def test_a_trailing_letter_becomes_a_digit():
    """序号位一定是数字。"""
    assert coerce("HIS") == ["H15"]


def test_the_first_character_is_never_turned_into_a_digit():
    """A1 不能被改成 41。方向搞反会让整本色卡失效。"""
    assert coerce("A1") == ["A1"]
