from tests.conftest import XRW


def _put(c, code, qty):
    return c.put(f"/api/inventory/{code}", json={"quantity": qty}, headers=XRW)


def test_list_is_newest_first_with_entries(auth_client):
    _put(auth_client, "A1", 100)
    auth_client.post("/api/inventory/batch", json={"mode": "deduct", "text": "A1,30"}, headers=XRW)
    ops = auth_client.get("/api/operations").json()
    assert [o["seq"] for o in ops] == [2, 1]
    assert ops[0]["type"] == "batch_deduct"
    assert ops[0]["entries"] == [{"code": "A1", "kind": "deduct", "amount": 30}]


def test_void_and_restore_replay(auth_client):
    _put(auth_client, "A1", 100)  # seq 1
    auth_client.post("/api/inventory/batch", json={"mode": "add", "text": "A1,50"}, headers=XRW)  # seq 2 -> 150

    r = auth_client.post("/api/operations/2/void", headers=XRW)
    assert r.json() == {"changes": [{"code": "A1", "from": 150, "to": 100}]}
    assert auth_client.get("/api/inventory").json()[0]["quantity"] == 100

    r = auth_client.post("/api/operations/2/restore", headers=XRW)
    assert r.json() == {"changes": [{"code": "A1", "from": 100, "to": 150}]}


def test_void_unknown_seq_is_404(auth_client):
    assert auth_client.post("/api/operations/99/void", headers=XRW).status_code == 404


def test_edit_a_middle_operation(auth_client):
    _put(auth_client, "A1", 100)  # seq 1
    auth_client.post("/api/inventory/batch", json={"mode": "add", "text": "A1,10"}, headers=XRW)  # seq 2
    auth_client.post("/api/inventory/batch", json={"mode": "deduct", "text": "A1,5"}, headers=XRW)  # seq 3 -> 105

    r = auth_client.patch(
        "/api/operations/2",
        json={"type": "batch_add", "payload": {"raw": "A1,40", "lines": [{"code": "A1", "qty": 40}]}},
        headers=XRW,
    )
    assert r.json() == {"changes": [{"code": "A1", "from": 105, "to": 135}]}
    ops = auth_client.get("/api/operations").json()
    assert next(o for o in ops if o["seq"] == 2)["edited_at"] is not None


def test_patch_rejects_unknown_code(auth_client):
    _put(auth_client, "A1", 100)
    r = auth_client.patch(
        "/api/operations/1",
        json={"type": "set", "payload": {"code": "ZZZ9", "qty": 1}},
        headers=XRW,
    )
    assert r.status_code == 422


def test_impact_matches_actual_void(auth_client):
    _put(auth_client, "A1", 100)
    auth_client.post("/api/inventory/batch", json={"mode": "add", "text": "A1,50"}, headers=XRW)
    preview = auth_client.post("/api/operations/2/impact", json={"mode": "void"}, headers=XRW).json()
    actual = auth_client.post("/api/operations/2/void", headers=XRW).json()
    assert preview == actual
