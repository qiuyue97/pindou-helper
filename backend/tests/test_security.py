import time

from app.security import (
    hash_password,
    make_token,
    read_token,
    verify_password,
)


def test_hash_roundtrip():
    h = hash_password("password123")
    assert h != "password123"
    assert verify_password(h, "password123") is True
    assert verify_password(h, "wrong") is False


def test_verify_never_raises_on_garbage():
    assert verify_password("not-a-hash", "x") is False


def test_token_roundtrip():
    tok = make_token(42)
    assert read_token(tok) == 42


def test_token_rejects_tampering():
    tok = make_token(42)
    assert read_token(tok + "x") is None
    assert read_token("garbage") is None


def test_token_expiry(monkeypatch):
    monkeypatch.setenv("PINDOU_JWT_DAYS", "0")
    from app.config import get_settings

    get_settings.cache_clear()
    tok = make_token(7)
    time.sleep(1)
    assert read_token(tok) is None
