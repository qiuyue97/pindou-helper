from tests.conftest import XRW


def _seed(c, pairs):
    for code, qty in pairs:
        assert (
            c.put(f"/api/inventory/{code}", json={"quantity": qty}, headers=XRW).status_code == 200
        )


def test_batch_add_all_or_nothing(auth_client):
    _seed(auth_client, [("A1", 100), ("A2", 100)])
    r = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "A1，20\nA2 5"},  # Chinese comma + space separators
        headers=XRW,
    )
    body = r.json()
    assert body["ok"] and body["applied"]
    assert {c["code"]: c["to"] for c in body["changes"]} == {"A1": 120, "A2": 105}


def test_batch_rejects_when_any_line_bad(auth_client):
    _seed(auth_client, [("A1", 100)])
    r = auth_client.post(
        "/api/inventory/batch",
        json={"mode": "deduct", "text": "A1,10\nZZZ9,5\nA1,x"},
        headers=XRW,
    )
    body = r.json()
    assert body["ok"] is False and body["applied"] is False and body["changes"] == []
    assert [x["status"] for x in body["results"]] == ["ok", "code_not_found", "bad_quantity"]
    assert auth_client.get("/api/inventory").json()[0]["quantity"] == 100


def test_batch_deduct_allows_negative(auth_client):
    _seed(auth_client, [("A1", 10)])
    r = auth_client.post(
        "/api/inventory/batch", json={"mode": "deduct", "text": "A1,25"}, headers=XRW
    )
    assert r.json()["changes"] == [{"code": "A1", "from": 10, "to": -15}]


def test_check_reports_enough_short_unknown(auth_client):
    _seed(auth_client, [("A1", 100)])
    r = auth_client.post(
        "/api/inventory/check",
        json={"text": "A1,60\nA1,150\nA2,10\nZZZ9,1"},
        headers=XRW,
    )
    res = r.json()["results"]
    assert [(x["code"], x["status"], x["have"]) for x in res] == [
        ("A1", "enough", 100),
        ("A1", "short", 100),
        ("A2", "short", 0),
        ("ZZZ9", "unknown_code", None),
    ]


def test_stockout_orders_negatives_first(auth_client):
    auth_client.patch("/api/settings", json={"threshold": 50}, headers=XRW)
    _seed(auth_client, [("A1", 200), ("A2", 10), ("A3", 40)])
    auth_client.post("/api/inventory/batch", json={"mode": "deduct", "text": "A2,60"}, headers=XRW)
    body = auth_client.get("/api/inventory/stockout").json()
    assert body["codes"] == ["A2", "A3"]
    assert body["text"] == "A2,A3"
