"""与 AI 抽取的图例对账。

这是整条 pipeline 里唯一一处有**两份独立证据**的地方：图例说这个色号有 3 个，
本图数出来 0 个，两者必有一个错。

对不上时把该色号的**全部**格子标紫，而不是挑几个。如果 H15 多了三个而 H20 少了
三个，那么每一个 H15 格子都是嫌疑人——全标出来才是对证据的诚实读法。
"""

from app.sheet.decide import ClassRecord
from app.sheet.reconcile import reconcile


def _rec(k, code, n, level="ok"):
    return ClassRecord(klass=k, code=code, source="ocr", level=level, de=0.5,
                       n=n, radius=1.0, rgb=[1, 2, 3], nearest=code,
                       nearest_de=0.5, read_full=code, off_list=False)


def test_matching_counts_stay_ok():
    recs = [_rec(0, "H15", 34)]
    rows = reconcile(recs, {"H15": 34})
    assert [r.level for r in rows] == ["ok"]
    assert recs[0].level == "ok"


def test_a_mismatch_turns_the_whole_code_purple():
    recs = [_rec(0, "H15", 37)]
    rows = reconcile(recs, {"H15": 34})
    assert rows[0].level == "count"
    assert rows[0].sheet == 37 and rows[0].prior == 34
    assert recs[0].level == "count"


def test_multiple_classes_of_one_code_merge_into_one_row():
    """紧切口下一个色号常常落在两三个类上。合并、求和。"""
    recs = [_rec(0, "H15", 20), _rec(1, "H15", 14)]
    rows = reconcile(recs, {"H15": 34})
    assert len(rows) == 1
    assert rows[0].sheet == 34
    assert sorted(rows[0].classes) == [0, 1]
    assert rows[0].level == "ok"


def test_a_prior_code_with_no_class_gets_its_own_purple_row():
    """图例说有 3 个 H20，pipeline 一个没产出。这一行是对账最有价值的产物。"""
    rows = reconcile([_rec(0, "H15", 37)], {"H15": 37, "H20": 3})
    by = {r.code: r for r in rows}
    assert by["H20"].sheet == 0
    assert by["H20"].prior == 3
    assert by["H20"].classes == []
    assert by["H20"].level == "count"


def test_a_code_the_legend_never_mentions_is_marked_custom_not_flagged():
    """图例里没有的色号 = 用户自己改出来的，那是预期的，不是「数量对不上」。

    判据是干净的：识别时 decide 把答案限制在先验内，所以只要有先验，识别刚结束时
    每个色号必然都在先验里。之后冒出来的只可能是用户改的。
    """
    rows = reconcile([_rec(0, "C6", 5)], {"H15": 10})
    by = {r.code: r for r in rows}
    assert by["C6"].prior is None
    assert by["C6"].custom is True
    assert by["C6"].level != "count"


def test_a_legend_code_is_not_custom():
    rows = reconcile([_rec(0, "H15", 10)], {"H15": 10})
    assert rows[0].custom is False


def test_without_a_prior_nothing_is_custom():
    """没有先验就没有「图例里有没有」这个问题。"""
    rows = reconcile([_rec(0, "H15", 10)], None)
    assert rows[0].custom is False


def test_a_legend_code_with_no_cells_left_is_still_flagged():
    """图例说有 3 个 H20，一个都没识别出来——这一行是对账最有价值的产物。"""
    rows = reconcile([_rec(0, "H15", 37)], {"H15": 37, "H20": 3})
    by = {r.code: r for r in rows}
    assert by["H20"].sheet == 0 and by["H20"].level == "count"
    assert by["H20"].custom is False


# ---------- counted：用户改过格子之后 ----------

def test_counted_overrides_the_class_totals():
    """改过格子之后，类的格子数就不再等于该色号实际占的格子数。"""
    recs = [_rec(0, "H15", 37)]
    rows = reconcile(recs, {"H15": 37}, counted={"H15": 36, "C6": 1})
    by = {r.code: r for r in rows}
    assert by["H15"].sheet == 36
    assert by["H15"].level == "count", "少了一格，要标出来"
    assert by["C6"].sheet == 1 and by["C6"].custom is True


def test_counted_can_introduce_a_code_with_no_class():
    """只在逐格覆盖里出现过的色号：没有任何类，但确实占着格子。"""
    rows = reconcile([_rec(0, "H15", 37)], {"H15": 36}, counted={"H15": 36, "M3": 1})
    by = {r.code: r for r in rows}
    assert by["M3"].classes == []
    assert by["M3"].sheet == 1


def test_without_a_prior_nothing_is_reconciled():
    """AI 抽取失败时不是「全都对不上」，而是没有第二份证据可比。"""
    recs = [_rec(0, "H15", 37)]
    rows = reconcile(recs, None)
    assert rows[0].level == "ok"
    assert rows[0].prior is None
    assert recs[0].level == "ok"


def test_a_worse_level_is_never_downgraded():
    """红色（猜出来的）比紫色更严重，对账不能把它降下去。"""
    recs = [_rec(0, "H15", 37, level="guess")]
    reconcile(recs, {"H15": 34})
    assert recs[0].level == "guess"


def test_rows_are_sorted_by_code_order():
    """A10 不能排在 A2 前面。"""
    recs = [_rec(0, "A10", 1), _rec(1, "A2", 1), _rec(2, "B1", 1)]
    rows = reconcile(recs, None)
    assert [r.code for r in rows] == ["A2", "A10", "B1"]
