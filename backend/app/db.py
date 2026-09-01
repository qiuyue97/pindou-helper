from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


@lru_cache
def get_engine() -> Engine:
    url = get_settings().db_url
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args, future=True)


@lru_cache
def get_sessionmaker() -> sessionmaker:
    return sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)


def get_session() -> Iterator[Session]:
    with get_sessionmaker()() as session:
        yield session


# Columns added after a deployment already had its database. create_all() only
# ever creates missing TABLES, so without this an added field stays invisible on
# an existing install until the file is deleted — which would throw away the
# user's inventory. Additive only: never drops or rewrites anything.
_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "users": {"is_vip": "BOOLEAN NOT NULL DEFAULT 0"},
    "pattern_jobs": {"extracted": "BOOLEAN NOT NULL DEFAULT 1"},
}


def _add_missing_columns(engine: Engine) -> None:
    # PRAGMA is SQLite-specific and SQLite is the only supported backend; a real
    # migration tool would be the answer if that ever changes.
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
            if not rows:
                continue  # create_all() will have made it with the column already
            existing = {r[1] for r in rows}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def init_db() -> None:
    from app import models  # noqa: F401  (register mappers)

    engine = get_engine()
    Base.metadata.create_all(engine)
    _add_missing_columns(engine)
