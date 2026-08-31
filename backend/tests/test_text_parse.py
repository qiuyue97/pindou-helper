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
