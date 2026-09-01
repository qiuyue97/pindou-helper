"""The VIP flag on an account, and the additive migration that introduces it."""

import sqlalchemy as sa
from sqlalchemy import select

from app.db import _add_missing_columns, get_engine, get_sessionmaker
from app.models import User
from tests.conftest import XRW


def _set_vip(app, username: str, value: bool) -> None:
    with get_sessionmaker()() as session:
        user = session.scalar(select(User).where(User.username == username))
        assert user is not None
        user.is_vip = value
        session.commit()


def test_new_accounts_are_not_vip(auth_client):
    assert auth_client.get("/api/auth/me").json()["is_vip"] is False


def test_register_reports_the_flag(client):
    res = client.post(
        "/api/auth/register",
        json={"username": "fresh", "password": "password123"},
        headers=XRW,
    )
    assert res.status_code == 200, res.text
    assert res.json()["is_vip"] is False


def test_promoting_an_account_shows_up_on_me_and_login(app, auth_client, client):
    _set_vip(app, "tester", True)
    assert auth_client.get("/api/auth/me").json()["is_vip"] is True

    res = client.post(
        "/api/auth/login",
        json={"username": "tester", "password": "password123"},
        headers=XRW,
    )
    assert res.json()["is_vip"] is True


def test_demoting_works_too(app, auth_client):
    _set_vip(app, "tester", True)
    _set_vip(app, "tester", False)
    assert auth_client.get("/api/auth/me").json()["is_vip"] is False


def test_migration_adds_the_column_to_a_database_that_predates_it(auth_client):
    """A live deployment already has a users table without is_vip.

    create_all() will not touch an existing table, so dropping the column and
    re-running the migration reproduces exactly what an upgrade does. auth_client
    is used so there IS a pre-existing row whose value we can check.
    """
    engine = get_engine()
    with engine.begin() as conn:
        conn.exec_driver_sql("ALTER TABLE users DROP COLUMN is_vip")
        cols = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()}
        assert "is_vip" not in cols

    _add_missing_columns(engine)

    with engine.begin() as conn:
        cols = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()}
        assert "is_vip" in cols
        # Pre-existing rows get the default rather than NULL.
        assert conn.exec_driver_sql("SELECT is_vip FROM users").scalar() == 0


def test_migration_is_idempotent(app):
    engine = get_engine()
    for _ in range(3):
        _add_missing_columns(engine)
    with engine.begin() as conn:
        names = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()]
    assert names.count("is_vip") == 1


def test_migration_is_a_no_op_on_other_backends():
    """PRAGMA is SQLite-only, so anything else must be left strictly alone."""
    calls: list[str] = []

    class FakeDialect:
        name = "postgresql"

    class FakeEngine:
        dialect = FakeDialect()

        def begin(self):  # pragma: no cover - must never be reached
            calls.append("begin")
            raise AssertionError("should not open a connection on a non-sqlite engine")

    _add_missing_columns(FakeEngine())  # type: ignore[arg-type]
    assert calls == []


def test_the_column_has_a_server_default_so_inserts_outside_the_orm_work(app):
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO users (username, password_hash, threshold, created_at) "
                "VALUES ('rawinsert', 'x', 500, '2026-01-01')"
            )
        )
        assert (
            conn.exec_driver_sql(
                "SELECT is_vip FROM users WHERE username = 'rawinsert'"
            ).scalar()
            == 0
        )
