import pytest
from starlette.testclient import TestClient

XRW = {"X-Requested-With": "pindou"}

# >= 32 bytes, so HS256 signing stays clear of the RFC 7518 §3.2 warning.
TEST_JWT_SECRET = "test-secret-for-pytest-only-0123456789"


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("PINDOU_DB_URL", f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    monkeypatch.setenv("PINDOU_JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.setenv("PINDOU_CORS_ORIGINS", "http://testserver")

    from app.config import get_settings
    from app.db import get_engine, get_sessionmaker, init_db

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()
    init_db()

    from app.main import create_app

    return create_app()


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def auth_client(client):
    r = client.post(
        "/api/auth/register",
        json={"username": "tester", "password": "password123"},
        headers=XRW,
    )
    assert r.status_code == 200, r.text
    return client
