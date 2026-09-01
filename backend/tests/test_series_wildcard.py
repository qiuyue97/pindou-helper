"""Series wildcards (``A*``) and the case-insensitivity of every wildcard.

``ALL`` already worked in any case because parse_lines() upper-cases the code
token; these tests pin that down so it cannot regress silently.
"""

from app.text_parse import (
    ALL_CODE,
    expand_lines,
    expand_wildcard,
    is_wildcard,
    parse_lines,
    series_of,
    series_wildcard,
)
from tests.conftest import XRW

SCOPE = ["A1", "A2", "B1", "ZG1", "ZG2", "M3"]


# ---------- recognition ----------


def test_series_wildcard_is_case_insensitive():
    assert series_wildcard("A*") == "A"
    assert series_wildcard(parse_lines("a*,5")[0].code) == "A"


def test_multi_letter_series_is_not_split():
    # ZG is one series, so "ZG*" must not be read as series "Z".
    assert series_wildcard("zg*") == "ZG"
    assert series_of("ZG1") == "ZG"


def test_plain_codes_are_not_wildcards():
    assert series_wildcard("A1") is None
    assert is_wildcard("A1") is False
    assert is_wildcard(None) is False
    assert is_wildcard(ALL_CODE) is True
    assert is_wildcard("A*") is True


def test_lowercase_all_parses_as_the_wildcard():
    for text in ("all,100", "All 100", "ALL,100"):
        assert parse_lines(text)[0].code == ALL_CODE


# ---------- expansion ----------


def test_series_wildcard_covers_only_its_own_series():
    assert expand_wildcard("A*", SCOPE) == ["A1", "A2"]
    assert expand_wildcard("ZG*", SCOPE) == ["ZG1", "ZG2"]


def test_unknown_series_expands_to_nothing():
    assert expand_wildcard("X*", SCOPE) == []


def test_all_still_covers_the_whole_scope():
    assert expand_wildcard(ALL_CODE, SCOPE) == SCOPE


def test_non_wildcard_returns_none_so_callers_can_tell_them_apart():
    assert expand_wildcard("A1", SCOPE) is None


def test_expand_lines_keeps_order_so_later_rows_accumulate():
    assert expand_lines([("A*", 10), ("A1", 5)], SCOPE) == [
        {"code": "A1", "qty": 10},
        {"code": "A2", "qty": 10},
        {"code": "A1", "qty": 5},
    ]


# ---------- through the API ----------


def _qty(auth_client, code):
    rows = auth_client.get("/api/inventory").json()
    return next((r["quantity"] for r in rows if r["code"] == code), 0)


def test_series_wildcard_restocks_only_that_series(auth_client):
    res = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "A*,1000", "scope": {"set": "221"}},
        headers=XRW,
    )
    assert res.status_code == 200, res.text
    assert res.json()["applied"] is True
    assert _qty(auth_client, "A1") == 1000
    assert _qty(auth_client, "B1") == 0


def test_lowercase_series_wildcard_works_through_the_api(auth_client):
    auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "a*,7", "scope": {"set": "221"}},
        headers=XRW,
    )
    assert _qty(auth_client, "A1") == 7


def test_lowercase_all_works_through_the_api(auth_client):
    auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "all,3", "scope": {"set": "221"}},
        headers=XRW,
    )
    assert _qty(auth_client, "A1") == 3
    assert _qty(auth_client, "M1") == 3


def test_a_series_nobody_matches_is_rejected_not_silently_ignored(auth_client):
    res = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "X*,5", "scope": {"set": "221"}},
        headers=XRW,
    )
    body = res.json()
    assert body["applied"] is False
    assert body["results"][0]["status"] == "code_not_found"


def test_special_series_is_empty_under_221_and_works_under_291(auth_client):
    # ZG only exists in the 291 set, so the same line must fail under 221.
    under_221 = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "ZG*,4", "scope": {"set": "221"}},
        headers=XRW,
    ).json()
    assert under_221["applied"] is False

    under_291 = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "ZG*,4", "scope": {"set": "291"}},
        headers=XRW,
    ).json()
    assert under_291["applied"] is True
    assert _qty(auth_client, "ZG1") == 4


def test_history_shows_the_wildcard_with_its_frozen_scope(auth_client):
    auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "A*,50", "scope": {"set": "221"}},
        headers=XRW,
    )
    op = auth_client.get("/api/operations").json()[0]
    # One typed row, not 26 expanded ones, and the set is visible.
    assert op["summary"] == "批量补货 A*(221) +50"
    assert op["scope_label"] == "A*(221)"
