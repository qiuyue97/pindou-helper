from sqlalchemy import select

from app.catalog import scope_codes
from app.db import get_sessionmaker
from app.models import User, UserColor
from app.text_parse import ALL_CODE, expand_lines
from tests.conftest import XRW

# ---------- pure expansion ----------

def test_expand_lines_replaces_all_in_place():
    pairs = [("ALL", 100), ("A1", 50)]
    assert expand_lines(pairs, ["A1", "A2"]) == [
        {"code": "A1", "qty": 100},
        {"code": "A2", "qty": 100},
        {"code": "A1", "qty": 50},
    ]


def test_expand_lines_without_all_is_a_passthrough():
    assert expand_lines([("A1", 5)], ["A1", "A2"]) == [{"code": "A1", "qty": 5}]


def test_all_code_constant():
    assert ALL_CODE == "ALL"


# ---------- scope resolution ----------

def test_scope_codes_221_excludes_special_series(app):
    with get_sessionmaker()() as s:
        u = User(username="scoped", password_hash="x")
        s.add(u)
        s.commit()
        codes = scope_codes(s, u.id, "221", include_custom=False)
    assert len(codes) == 221
    assert "A1" in codes and "M15" in codes
    assert not any(c.startswith(("P", "Q", "R", "T", "Y", "ZG")) for c in codes)


def test_scope_codes_291_and_customs(app):
    with get_sessionmaker()() as s:
        u = User(username="scoped2", password_hash="x")
        s.add(u)
        s.commit()
        s.add(UserColor(user_id=u.id, code="X1", hex="A03D2F", source="custom"))
        s.add(UserColor(user_id=u.id, code="C7", hex="9D5B3E", source="override"))
        s.commit()
        assert len(scope_codes(s, u.id, "291", include_custom=False)) == 291
        with_custom = scope_codes(s, u.id, "291", include_custom=True)
    assert len(with_custom) == 292
    assert with_custom[-1] == "X1"  # customs appended after the base catalogue


# ---------- the endpoint ----------

def test_batch_all_expands_over_the_requested_scope(auth_client):
    r = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "ALL,100", "scope": {"set": "221", "include_custom": True}},
        headers=XRW,
    )
    body = r.json()
    assert body["ok"] and body["applied"]
    assert len(body["changes"]) == 221
    assert {c["to"] for c in body["changes"]} == {100}
    assert not any(c["code"].startswith("T") for c in body["changes"])


def test_batch_all_291_covers_every_colour(auth_client):
    r = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "ALL,5", "scope": {"set": "291", "include_custom": True}},
        headers=XRW,
    )
    assert len(r.json()["changes"]) == 291


def test_all_mixed_with_a_normal_line_accumulates(auth_client):
    r = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "ALL,100\nA1,50", "scope": {"set": "221", "include_custom": True}},
        headers=XRW,
    )
    changes = {c["code"]: c["to"] for c in r.json()["changes"]}
    assert changes["A1"] == 150  # ALL then the explicit line, folded in order
    assert changes["A2"] == 100


def test_batch_all_deduct_goes_negative(auth_client):
    r = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "deduct", "text": "ALL,30", "scope": {"set": "221", "include_custom": True}},
        headers=XRW,
    )
    assert {c["to"] for c in r.json()["changes"]} == {-30}


def test_all_includes_custom_colours_when_asked(auth_client):
    auth_client.post("/api/colors", json={"code": "X1", "hex": "A03D2F"}, headers=XRW)
    r = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "ALL,7", "scope": {"set": "221", "include_custom": True}},
        headers=XRW,
    )
    codes = {c["code"] for c in r.json()["changes"]}
    assert "X1" in codes and len(codes) == 222


def test_all_excludes_custom_colours_when_not_asked(auth_client):
    auth_client.post("/api/colors", json={"code": "X1", "hex": "A03D2F"}, headers=XRW)
    r = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "ALL,7", "scope": {"set": "221", "include_custom": False}},
        headers=XRW,
    )
    assert "X1" not in {c["code"] for c in r.json()["changes"]}


def test_scope_defaults_to_291_with_customs_when_omitted(auth_client):
    r = auth_client.post(
        "/api/inventory/batch", json={"mode": "add", "text": "ALL,1"}, headers=XRW
    )
    assert len(r.json()["changes"]) == 291


def test_the_operation_records_the_scope_and_stays_replayable(auth_client):
    auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "ALL,100", "scope": {"set": "221", "include_custom": True}},
        headers=XRW,
    )
    with get_sessionmaker()() as s:
        from app.models import Operation

        op = s.scalar(select(Operation))
        assert op.payload["scope"] == {"kind": "all", "set": "221", "include_custom": True}
        assert op.payload["raw"] == "ALL,100"
        assert len(op.payload["lines"]) == 221  # frozen at submit time

    # voiding it must undo all 221
    r = auth_client.post("/api/operations/1/void", headers=XRW)
    assert len(r.json()["changes"]) == 221
    assert auth_client.get("/api/inventory").json() == []
