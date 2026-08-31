from app.replay import ReplayOp, diff_inventory, referenced_codes, replay


def op(seq, type_, payload, voided=False):
    return ReplayOp(seq, voided, type_, payload)


def test_replay_add_set_deduct_delete_sequence():
    ops = [
        op(1, "add_code", {"code": "A1", "qty": 100}),
        op(2, "single_add", {"code": "A1", "qty": 50}),
        op(3, "batch_deduct", {"raw": "", "lines": [{"code": "A1", "qty": 30}, {"code": "B2", "qty": 10}]}),
        op(4, "set", {"code": "C3", "qty": 7}),
        op(5, "delete", {"code": "C3"}),
    ]
    assert replay(ops) == {"A1": 120, "B2": -10}


def test_replay_is_seq_ordered_not_list_ordered():
    ops = [op(2, "single_add", {"code": "A1", "qty": 5}), op(1, "set", {"code": "A1", "qty": 1})]
    assert replay(ops) == {"A1": 6}


def test_voided_ops_are_skipped():
    ops = [
        op(1, "set", {"code": "A1", "qty": 100}),
        op(2, "single_deduct", {"code": "A1", "qty": 40}, voided=True),
    ]
    assert replay(ops) == {"A1": 100}


def test_negative_results_persist():
    assert replay([op(1, "single_deduct", {"code": "A1", "qty": 5})]) == {"A1": -5}


def test_diff_inventory():
    d = diff_inventory({"A1": 100, "B2": 5}, {"A1": 120, "C3": 7})
    assert d == [
        {"code": "A1", "from": 100, "to": 120},
        {"code": "B2", "from": 5, "to": None},
        {"code": "C3", "from": None, "to": 7},
    ]


def test_referenced_codes_ignores_voided():
    ops = [
        op(1, "batch_add", {"raw": "", "lines": [{"code": "A1", "qty": 1}, {"code": "B2", "qty": 1}]}),
        op(2, "set", {"code": "C3", "qty": 1}, voided=True),
        op(3, "delete", {"code": "D4"}),
    ]
    assert referenced_codes(ops) == {"A1", "B2", "D4"}
