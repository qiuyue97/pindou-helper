"""与 AI 抽取的图例对账。

这是整条 pipeline 里唯一一处有**两份独立证据**的地方：图例说这个色号有 3 个，
本图数出来 0 个，两者必有一个错。

对不上时把该色号的**全部**格子标紫，而不是挑几个。如果 H15 多了三个而 H20 少了
三个，那么每一个 H15 格子都是嫌疑人——全标出来才是对证据的诚实读法。
"""

from app.sheet.decide import ClassRecord
from app.sheet.reconcile import reconcile


def _rec(k, code, n, level="ok"):
    """造一条**自洽**的类记录。

    level 必须和它的依据对得上：真实数据里 guess 一定是颜色兜底来的
    （source="guess"），warn 一定有个说得出的理由（这里用 de 超阈值）。对账现在
    会从这些字段反推固有级别，喂给它一条「source=ocr 但 level=guess」的记录，
    测的就不是真实存在的情形了。
    """
    return ClassRecord(klass=k, code=code,
                       source="guess" if level == "guess" else "ocr",
                       level=level, de=9.0 if level == "warn" else 0.5,
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


# ---------- count 是算出来的，不是留下来的 ----------

def test_a_resolved_mismatch_clears_the_flag():
    """用户把数量改对了，红色感叹号就得消失。

    这是真踩过的 bug：count 被写进类的 level，下一次对账取「已有 level 和 count
    的最大值」，于是 count 只进不出——图纸数量 87、已识别数量 87，感叹号还挂着。
    """
    recs = [_rec(0, "C19", 129)]
    assert reconcile(recs, {"C19": 87})[0].level == "count"
    assert recs[0].level == "count"

    # 同一批 records 再对一次账，这次数量对上了
    rows = reconcile(recs, {"C19": 87}, counted={"C19": 87})
    assert rows[0].level == "ok"
    assert recs[0].level == "ok", "类身上那个 count 也要摘掉"


def test_clearing_count_does_not_erase_the_class_own_warning():
    """摘掉 count 不能顺手把这一类自己的橙色告警也摘了。"""
    recs = [_rec(0, "H15", 37)]
    recs[0].de = 9.0                      # 颜色和读出的色号差得远 -> 固有 warn
    reconcile(recs, {"H15": 34})
    assert recs[0].level == "count"       # count 比 warn 重
    rows = reconcile(recs, {"H15": 37})
    assert rows[0].level == "warn"
    assert recs[0].level == "warn"


def test_warn_and_guess_do_not_jump_the_queue():
    """左栏不标 warn/guess，就不能按它们排序——顺序会莫名其妙地变。"""
    recs = [_rec(0, "Z9", 1), _rec(1, "A1", 1, level="warn"), _rec(2, "B2", 1, level="guess")]
    rows = reconcile(recs, {"Z9": 5, "A1": 1, "B2": 1})
    assert [r.code for r in rows] == ["Z9", "A1", "B2"], "只有 Z9 数量对不上"


def test_a_guess_stays_red_through_a_resolved_mismatch():
    recs = [_rec(0, "H15", 37, level="guess")]
    recs[0].source = "guess"
    rows = reconcile(recs, {"H15": 37})
    assert rows[0].level == "guess" and recs[0].level == "guess"


# ---------- 排序 ----------

def test_problem_rows_come_first_each_group_sorted_by_code():
    """数量对不上的全部排在上面，两组各自 A-Z、1-99。"""
    recs = [_rec(0, "A10", 1), _rec(1, "A2", 1), _rec(2, "B1", 1), _rec(3, "B20", 1)]
    rows = reconcile(recs, {"A10": 1, "A2": 9, "B1": 1, "B20": 7})
    assert [r.code for r in rows] == ["A2", "B20", "A10", "B1"]
    assert [r.level for r in rows] == ["count", "count", "ok", "ok"]


def test_a_custom_code_is_not_treated_as_a_problem():
    """绿色的自建色号不该被顶到最上面——那不是问题，是用户自己确认过的。"""
    rows = reconcile([_rec(0, "C6", 5), _rec(1, "H15", 3)], {"H15": 9})
    assert [r.code for r in rows] == ["H15", "C6"]
    assert rows[1].custom is True and rows[1].level == "ok"
