"""由 labels + classes + overrides 现推矩阵。

存死矩阵的话，「把这一类的 200 格都改成 H15」要重写 200 个元素；现推的话那是改
一个字段。两级操作能成立就靠这个。
"""

import pytest

from app.sheet.matrix import (
    apply_cell_patch,
    apply_class_patch,
    bead_list,
    code_at,
    matrix,
    tally,
)

CLASSES = [{"klass": 0, "code": "A2"}, {"klass": 1, "code": "H15"}]
LABELS = [0, 1, 1, 0, -1, 0]      # 2 行 3 列


def test_the_matrix_comes_from_the_class_codes():
    assert matrix(LABELS, CLASSES, {}, 2, 3) == [["A2", "H15", "H15"],
                                                 ["A2", "", "A2"]]


def test_a_blank_cell_is_an_empty_string():
    assert code_at(LABELS, CLASSES, {}, 1, 1, 3) == ""


def test_an_override_wins_over_the_class():
    m = matrix(LABELS, CLASSES, {"0,0": "C6"}, 2, 3)
    assert m[0][0] == "C6"
    assert m[1][0] == "A2", "同一类的其他格子不受影响"


def test_code_at_agrees_with_the_matrix():
    m = matrix(LABELS, CLASSES, {"0,0": "C6"}, 2, 3)
    for r in range(2):
        for c in range(3):
            assert code_at(LABELS, CLASSES, {"0,0": "C6"}, r, c, 3) == m[r][c]


def test_changing_a_class_moves_every_one_of_its_cells():
    cls = apply_class_patch(CLASSES, [{"k": 0, "code": "B8"}])
    m = matrix(LABELS, cls, {}, 2, 3)
    assert [c for row in m for c in row].count("B8") == 3


def test_an_override_survives_a_class_change():
    """人工改过的那一格是用户的决定，改整类不该把它冲掉。"""
    cls = apply_class_patch(CLASSES, [{"k": 0, "code": "B8"}])
    m = matrix(LABELS, cls, {"0,0": "C6"}, 2, 3)
    assert m[0][0] == "C6"
    assert m[1][0] == "B8"


def test_a_class_patch_does_not_mutate_its_input():
    before = [dict(c) for c in CLASSES]
    apply_class_patch(CLASSES, [{"k": 0, "code": "B8"}])
    assert CLASSES == before


def test_an_empty_code_clears_an_override():
    ov = apply_cell_patch({"0,0": "C6"}, [{"r": 0, "c": 0, "code": ""}], 2, 3)
    assert ov == {}


def test_codes_are_upper_cased():
    ov = apply_cell_patch({}, [{"r": 0, "c": 0, "code": " h15 "}], 2, 3)
    assert ov == {"0,0": "H15"}


def test_an_out_of_range_cell_is_rejected():
    with pytest.raises(ValueError):
        apply_cell_patch({}, [{"r": 9, "c": 0, "code": "A2"}], 2, 3)
    with pytest.raises(ValueError):
        apply_cell_patch({}, [{"r": 0, "c": -1, "code": "A2"}], 2, 3)


def test_an_unknown_class_index_is_rejected():
    with pytest.raises(ValueError):
        apply_class_patch(CLASSES, [{"k": 7, "code": "A2"}])


def test_tally_counts_the_effective_matrix():
    assert tally(LABELS, CLASSES, {"0,0": "C6"}, 2, 3) == {"A2": 2, "H15": 2,
                                                           "C6": 1}


def test_bead_list_is_sorted_by_code_order_not_by_string():
    """A10 不能排在 A2 前面——「按图扣减」按行读，顺序错了用户就得自己重排。"""
    assert bead_list({"A10": 3, "A2": 5, "B1": 1}) == "A2, 5\nA10, 3\nB1, 1"


def test_bead_list_is_empty_for_an_empty_tally():
    assert bead_list({}) == ""


def test_a_big_matrix_is_derived_without_storing_it():
    """104x104 = 10,816 格。改整类只改一个字段，不重写一万个元素。"""
    rows = cols = 104
    labels = [i % 40 for i in range(rows * cols)]
    classes = [{"klass": k, "code": f"A{k + 1}"} for k in range(40)]
    t = tally(labels, classes, {}, rows, cols)
    assert sum(t.values()) == rows * cols
    moved = apply_class_patch(classes, [{"k": 0, "code": "M3"}])
    assert tally(labels, moved, {}, rows, cols)["M3"] == t["A1"]
