from tests.conftest import XRW

ALL_221 = {"mode": "add", "text": "ALL,100", "scope": {"set": "221", "include_custom": True}}


def test_all_operation_collapses_to_one_entry(auth_client):
    auth_client.post("/api/inventory/batch", json=ALL_221, headers=XRW)
    op = auth_client.get("/api/operations").json()[0]
    assert len(op["entries"]) == 1, "221 entries would flood the history column"
    assert op["entries"][0]["code"] == "ALL"
    assert op["entries"][0]["amount"] == 100
    assert op["scope_label"] == "ALL(221)"
    assert "ALL(221)" in op["summary"]
    assert "+100" in op["summary"]


def test_291_scope_is_labelled_distinctly(auth_client):
    auth_client.post(
        "/api/inventory/batch",
        json={"mode": "deduct", "text": "ALL,5", "scope": {"set": "291", "include_custom": True}},
        headers=XRW,
    )
    op = auth_client.get("/api/operations").json()[0]
    assert op["scope_label"] == "ALL(291)"
    assert "-5" in op["summary"]


def test_mixed_all_shows_both_the_wildcard_and_the_explicit_line(auth_client):
    auth_client.post(
        "/api/inventory/batch",
        json={"mode": "add", "text": "ALL,100\nA1,50", "scope": {"set": "221", "include_custom": True}},
        headers=XRW,
    )
    op = auth_client.get("/api/operations").json()[0]
    codes = [e["code"] for e in op["entries"]]
    assert codes == ["ALL", "A1"]


def test_plain_batch_is_unchanged_and_has_no_scope_label(auth_client):
    auth_client.put("/api/inventory/A1", json={"quantity": 10}, headers=XRW)
    auth_client.post(
        "/api/inventory/batch", json={"mode": "add", "text": "A1,5"}, headers=XRW
    )
    op = auth_client.get("/api/operations").json()[0]
    assert op["scope_label"] is None
    assert [e["code"] for e in op["entries"]] == ["A1"]


def test_operations_expose_the_raw_text_for_editing(auth_client):
    auth_client.post("/api/inventory/batch", json=ALL_221, headers=XRW)
    op = auth_client.get("/api/operations").json()[0]
    assert op["raw"] == "ALL,100", "the edit dialog cannot reconstruct ALL from entries"


def test_editing_an_all_operation_keeps_its_own_scope(auth_client):
    auth_client.post("/api/inventory/batch", json=ALL_221, headers=XRW)
    # re-submit the same op with a smaller amount, still 221-scoped
    r = auth_client.patch(
        "/api/operations/1",
        json={
            "type": "batch_add",
            "payload": {
                "raw": "ALL,80",
                "scope": {"kind": "all", "set": "221", "include_custom": True},
                "lines": [{"code": "A1", "qty": 80}],
            },
        },
        headers=XRW,
    )
    assert r.status_code == 200
    op = auth_client.get("/api/operations").json()[0]
    assert op["scope_label"] == "ALL(221)"
    assert op["raw"] == "ALL,80"
