from app.text_parse import normalize, parse_lines


def test_normalize_chinese_punctuation():
    assert normalize("A1，100") == "A1,100"
    assert normalize("A1　100") == "A1 100"
    assert normalize("A1 , 100") == "A1,100"


def test_parse_ok_comma_and_space_separators():
    lines = parse_lines("A1,100\nb2 50\n C3 , 7 ")
    assert [(l.code, l.qty, l.status) for l in lines] == [
        ("A1", 100, "ok"),
        ("B2", 50, "ok"),
        ("C3", 7, "ok"),
    ]


def test_parse_skips_blank_lines_but_keeps_line_numbers():
    lines = parse_lines("A1,1\n\n\nA2,2")
    assert [(l.line_no, l.code) for l in lines] == [(1, "A1"), (4, "A2")]


def test_parse_flags_bad_rows():
    lines = parse_lines("A1\nA2,0\nA3,-4\nA4,x\nA5,1,2")
    assert [l.status for l in lines] == [
        "format_error",
        "bad_quantity",
        "bad_quantity",
        "bad_quantity",
        "format_error",
    ]


# ---------- 色号顺序 ----------


def test_codes_sort_by_series_then_number_not_as_strings():
    """A10 必须排在 A2 后面。裸字符串排序做不到这一点。"""
    from app.text_parse import code_key

    codes = ["A10", "A2", "B1", "A1", "C22", "C3", "M15", "M2"]
    assert sorted(codes, key=code_key) == [
        "A1", "A2", "A10", "B1", "C3", "C22", "M2", "M15",
    ]


def test_multi_letter_series_stay_together():
    """291 色表里有 ZG 这样的双字母系列。"""
    from app.text_parse import code_key

    assert sorted(["ZG2", "Z1", "ZG10", "ZG1"], key=code_key) == [
        "Z1", "ZG1", "ZG2", "ZG10",
    ]


def test_an_odd_code_still_sorts_deterministically():
    """没有数字、或者带后缀的，也得有个稳定的位置，不能抛异常。"""
    from app.text_parse import code_key

    assert sorted(["A", "A1", "1", ""], key=code_key) == ["", "1", "A", "A1"]
