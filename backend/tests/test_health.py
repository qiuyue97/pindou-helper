def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_csrf_blocks_unheadered_post(client):
    r = client.post("/api/auth/register", json={"username": "x", "password": "y"})
    assert r.status_code == 403
