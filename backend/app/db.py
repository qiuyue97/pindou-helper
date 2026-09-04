from collections.abc import Iterator
from datetime import UTC, datetime
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
    "pattern_jobs": {
        "extracted": "BOOLEAN NOT NULL DEFAULT 1",
        "items": "JSON",
    },
    "sheets": {
        "name": "VARCHAR(80) NOT NULL DEFAULT ''",
        "position": "INTEGER NOT NULL DEFAULT 0",
        "kind": "VARCHAR(10) NOT NULL DEFAULT 'recognise'",
        "step": "VARCHAR(64) NOT NULL DEFAULT ''",
        "progress": "INTEGER NOT NULL DEFAULT 0",
    },
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


#: 重启时要收尾的表，以及「还在跑」是哪几个状态。
#: sheets 的 "ready"（传完了在等用户确认网格）不在其列——那时根本没有线程在跑。
_IN_FLIGHT: dict[str, tuple[str, ...]] = {
    "pattern_jobs": ("pending", "running"),
    "sheets": ("pending", "running"),
}

_INTERRUPTED = "服务重启，识别中断。可以重新发起。"


def _fail_orphaned_jobs(engine: Engine) -> None:
    """把重启前还在跑的任务标成失败。

    识别是后台线程做的，进程没了就没人接着跑，也**没人收尾**。行还在（SQLite 在
    持久卷上），但它会永远停在 pending/running，后果有两个：前端据此一直轮询转圈，
    用户看不出发生了什么；而 sheets 那边的并发保护会因此拒绝重新识别，等于把那张图
    锁死，只能删掉重传。

    丢的从来不是状态，是**执行**——所以这里补的是一次收尾，不是持久化。

    **不自动重跑，是刻意的。** PatternJob 重跑要重新调 FastGPT，那是真的花钱；
    而重启很可能是崩溃循环，自动重跑会反复烧。标成失败，把要不要重来交给用户。
    """
    now = datetime.now(UTC)
    with engine.begin() as conn:
        for table, states in _IN_FLIGHT.items():
            rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
            if not rows:
                continue                      # 这张表还没建出来
            placeholders = ", ".join("?" * len(states))
            conn.exec_driver_sql(
                f"UPDATE {table} SET status = 'failed', error = ?, "
                f"finished_at = ? WHERE status IN ({placeholders})",
                (_INTERRUPTED, now.isoformat(sep=" "), *states),
            )


def init_db() -> None:
    from app import models  # noqa: F401  (register mappers)

    engine = get_engine()
    Base.metadata.create_all(engine)
    _add_missing_columns(engine)
    _fail_orphaned_jobs(engine)
