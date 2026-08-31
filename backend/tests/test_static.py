import pytest
from starlette.testclient import TestClient

from tests.conftest import TEST_JWT_SECRET


@pytest.fixture()
def spa_app(tmp_path, monkeypatch):
    static = tmp_path / "spa"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html><title>pindou</title>", encoding="utf-8")

    monkeypatch.setenv("PINDOU_DB_URL", f"sqlite:///{(tmp_path / 't.db').as_posix()}")
    monkeypatch.setenv("PINDOU_JWT_SECRET", TEST_JWT_SECRET)
    monkeypatch.setenv("PINDOU_STATIC_DIR", str(static))

    from app.config import get_settings
    from app.db import get_engine, get_sessionmaker, init_db

    get_settings.cache_clear()
    get_engine.cache_clear()
    get_sessionmaker.cache_clear()
    init_db()

    from app.main import create_app

    return create_app()


def test_spa_served_and_api_still_works(spa_app):
    c = TestClient(spa_app)
    assert c.get("/").status_code == 200
    assert "pindou" in c.get("/").text
    assert c.get("/some/client/route").status_code == 200  # SPA fallback
    assert c.get("/api/health").json() == {"status": "ok"}


def test_no_static_dir_means_no_root(client):
    assert client.get("/").status_code == 404
