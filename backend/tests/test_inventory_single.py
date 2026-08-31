from tests.conftest import XRW


def test_put_creates_then_updates_and_reports_diff(auth_client):
    r = auth_client.put("/api/inventory/A1", json={"quantity": 100}, headers=XRW)
    assert r.status_code == 200
    assert r.json() == {"changes": [{"code": "A1", "from": None, "to": 100}]}

    r = auth_client.put("/api/inventory/A1", json={"quantity": 80}, headers=XRW)
    assert r.json() == {"changes": [{"code": "A1", "from": 100, "to": 80}]}

    rows = auth_client.get("/api/inventory").json()
    assert rows == [{"code": "A1", "quantity": 80, "updated_at": rows[0]["updated_at"]}]


def test_put_rejects_unknown_code(auth_client):
    assert auth_client.put("/api/inventory/ZZZ9", json={"quantity": 1}, headers=XRW).status_code == 422


def test_delete_missing_is_404_then_works(auth_client):
    assert auth_client.delete("/api/inventory/A1", headers=XRW).status_code == 404
    auth_client.put("/api/inventory/A1", json={"quantity": 5}, headers=XRW)
    r = auth_client.delete("/api/inventory/A1", headers=XRW)
    assert r.json() == {"changes": [{"code": "A1", "from": 5, "to": None}]}
    assert auth_client.get("/api/inventory").json() == []


def test_inventory_is_per_user(client):
    client.post("/api/auth/register", json={"username": "user1", "password": "password123"}, headers=XRW)
    client.put("/api/inventory/A1", json={"quantity": 10}, headers=XRW)
    client.post("/api/auth/logout", headers=XRW)
    client.post("/api/auth/register", json={"username": "user2", "password": "password123"}, headers=XRW)
    assert client.get("/api/inventory").json() == []
