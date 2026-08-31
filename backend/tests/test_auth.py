from tests.conftest import XRW


def test_register_login_me_flow(client):
    r = client.post(
        "/api/auth/register", json={"username": "amy", "password": "password123"}, headers=XRW
    )
    assert r.status_code == 200
    assert r.json() == {"username": "amy", "threshold": 500}
    assert client.cookies.get("session")

    client.cookies.clear()
    r = client.post(
        "/api/auth/login", json={"username": "amy", "password": "password123"}, headers=XRW
    )
    assert r.status_code == 200

    r = client.get("/api/auth/me")
    assert r.status_code == 200 and r.json()["username"] == "amy"


def test_register_rejects_bad_input(client):
    assert (
        client.post(
            "/api/auth/register", json={"username": "ab", "password": "password123"}, headers=XRW
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/auth/register", json={"username": "abcd", "password": "short"}, headers=XRW
        ).status_code
        == 422
    )


def test_register_conflict(client):
    client.post("/api/auth/register", json={"username": "bob", "password": "password123"}, headers=XRW)
    r = client.post(
        "/api/auth/register", json={"username": "bob", "password": "password123"}, headers=XRW
    )
    assert r.status_code == 409


def test_login_bad_password(client):
    client.post("/api/auth/register", json={"username": "carol", "password": "password123"}, headers=XRW)
    r = client.post("/api/auth/login", json={"username": "carol", "password": "nope"}, headers=XRW)
    assert r.status_code == 401


def test_me_requires_auth(client):
    assert client.get("/api/auth/me").status_code == 401


def test_logout_clears_session(auth_client):
    assert auth_client.post("/api/auth/logout", headers=XRW).status_code == 204
    assert auth_client.get("/api/auth/me").status_code == 401


def test_patch_settings(auth_client):
    r = auth_client.patch("/api/settings", json={"threshold": 250}, headers=XRW)
    assert r.status_code == 200 and r.json() == {"threshold": 250}
    assert auth_client.get("/api/auth/me").json()["threshold"] == 250
