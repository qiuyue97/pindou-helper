"""The VIP gate is enforced by the server, against the database.

Hiding a button in the UI is not access control. These tests come at the gate the
way an attacker would: with curl, forged request bodies, and a stale session.
"""

from sqlalchemy import select

from app.db import get_sessionmaker
from app.models import User
from tests.conftest import XRW


def _set_vip(username: str, value: bool) -> None:
    with get_sessionmaker()() as session:
        user = session.scalar(select(User).where(User.username == username))
        assert user is not None
        user.is_vip = value
        session.commit()


# ---------- the gate ----------


def test_a_normal_account_is_refused(auth_client):
    res = auth_client.post("/api/smart/extract", json={"text": "A1 补 200"}, headers=XRW)
    assert res.status_code == 403
    assert res.json()["detail"] == "VIP only"


def test_a_vip_account_gets_past_the_gate(auth_client):
    _set_vip("tester", True)
    res = auth_client.post("/api/smart/extract", json={"text": "A1 补 200"}, headers=XRW)
    # 503 = past the gate, and then the LLM gateway is not configured in tests.
    # Anything but 403 proves the gate opened; the point here is that it is the
    # DATABASE that opened it, not anything the caller sent.
    assert res.status_code == 503


def test_an_anonymous_caller_is_refused_before_vip_is_even_considered(client):
    res = client.post("/api/smart/extract", json={"text": "x"}, headers=XRW)
    assert res.status_code == 401


def test_the_gate_still_applies_without_the_csrf_header(auth_client):
    _set_vip("tester", True)
    # CSRF guard runs first; the endpoint must not be reachable around it.
    res = auth_client.post("/api/smart/extract", json={"text": "x"})
    assert res.status_code == 403
    assert res.json()["detail"] == "missing X-Requested-With"


# ---------- privileges cannot be injected ----------


def test_register_cannot_smuggle_in_the_vip_flag(client):
    res = client.post(
        "/api/auth/register",
        json={"username": "sneaky", "password": "password123", "is_vip": True},
        headers=XRW,
    )
    # Rejected outright rather than silently ignored, so the attempt is visible.
    assert res.status_code == 422

    # And nothing was created.
    with get_sessionmaker()() as session:
        assert session.scalar(select(User).where(User.username == "sneaky")) is None


def test_login_cannot_smuggle_in_the_vip_flag(auth_client):
    res = auth_client.post(
        "/api/auth/login",
        json={"username": "tester", "password": "password123", "is_vip": True},
        headers=XRW,
    )
    assert res.status_code == 422


def test_settings_cannot_smuggle_in_the_vip_flag(auth_client):
    res = auth_client.patch(
        "/api/settings", json={"threshold": 100, "is_vip": True}, headers=XRW
    )
    assert res.status_code == 422
    assert auth_client.get("/api/auth/me").json()["is_vip"] is False


def test_a_registered_account_starts_without_vip_whatever_was_sent(client):
    client.post(
        "/api/auth/register",
        json={"username": "plain", "password": "password123"},
        headers=XRW,
    )
    with get_sessionmaker()() as session:
        user = session.scalar(select(User).where(User.username == "plain"))
        assert user is not None and user.is_vip is False


# ---------- the flag is read live, not carried in the session ----------


def test_revoking_vip_takes_effect_without_re_login(auth_client):
    _set_vip("tester", True)
    assert (
        auth_client.post("/api/smart/extract", json={"text": "x"}, headers=XRW).status_code
        == 503
    )

    # Same cookie, no new login: the token holds only the user id, so the very
    # next request re-reads is_vip from the database.
    _set_vip("tester", False)
    assert (
        auth_client.post("/api/smart/extract", json={"text": "x"}, headers=XRW).status_code
        == 403
    )


def test_granting_vip_also_takes_effect_immediately(auth_client):
    assert (
        auth_client.post("/api/smart/extract", json={"text": "x"}, headers=XRW).status_code
        == 403
    )
    _set_vip("tester", True)
    assert (
        auth_client.post("/api/smart/extract", json={"text": "x"}, headers=XRW).status_code
        == 503
    )


def test_the_session_token_carries_no_privilege_claim(auth_client):
    """If is_vip ever ends up inside the JWT, revocation silently stops working."""
    import jwt

    from app.security import SESSION_COOKIE

    token = auth_client.cookies.get(SESSION_COOKIE)
    assert token
    claims = jwt.decode(token, options={"verify_signature": False})
    assert set(claims) == {"sub", "iat", "exp"}
