from tests.conftest import XRW


def test_add_custom_then_list(auth_client):
    r = auth_client.post("/api/colors", json={"code": "x1", "hex": "#a03d2f"}, headers=XRW)
    assert r.status_code == 201
    assert r.json() == {"code": "X1", "hex": "A03D2F", "source": "custom", "base_hex": None}
    assert auth_client.get("/api/colors").json() == [
        {"code": "X1", "hex": "A03D2F", "source": "custom", "base_hex": None}
    ]


def test_add_custom_conflicts(auth_client):
    assert (
        auth_client.post("/api/colors", json={"code": "A1", "hex": "000000"}, headers=XRW).status_code
        == 409
    )
    auth_client.post("/api/colors", json={"code": "X1", "hex": "000000"}, headers=XRW)
    assert (
        auth_client.post("/api/colors", json={"code": "X1", "hex": "111111"}, headers=XRW).status_code
        == 409
    )


def test_override_base_and_revert(auth_client):
    r = auth_client.put("/api/colors/C7", json={"hex": "9D5B3E"}, headers=XRW)
    assert r.json()["source"] == "override"
    assert r.json()["base_hex"] == "3677D2"  # C7's actual base hex
    assert auth_client.delete("/api/colors/C7", headers=XRW).status_code == 204
    assert auth_client.get("/api/colors").json() == []


def test_put_unknown_custom_is_404(auth_client):
    assert auth_client.put("/api/colors/NOPE", json={"hex": "000000"}, headers=XRW).status_code == 404


def test_delete_custom_blocked_while_referenced(auth_client):
    auth_client.post("/api/colors", json={"code": "X1", "hex": "A03D2F"}, headers=XRW)
    auth_client.put("/api/inventory/X1", json={"quantity": 5}, headers=XRW)
    assert auth_client.delete("/api/colors/X1", headers=XRW).status_code == 409
    auth_client.delete("/api/inventory/X1", headers=XRW)  # still referenced by the (non-voided) ops
    assert auth_client.delete("/api/colors/X1", headers=XRW).status_code == 409
    for o in auth_client.get("/api/operations").json():
        auth_client.post(f"/api/operations/{o['seq']}/void", headers=XRW)
    assert auth_client.delete("/api/colors/X1", headers=XRW).status_code == 204


def test_colors_are_per_user(client):
    client.post("/api/auth/register", json={"username": "pers1", "password": "password123"}, headers=XRW)
    client.put("/api/colors/C7", json={"hex": "9D5B3E"}, headers=XRW)
    client.post("/api/auth/logout", headers=XRW)
    client.post("/api/auth/register", json={"username": "pers2", "password": "password123"}, headers=XRW)
    assert client.get("/api/colors").json() == []
