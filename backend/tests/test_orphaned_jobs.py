"""重启前还在跑的任务，启动时收尾。

识别是后台线程做的。容器一重启，进程没了，没人接着跑，也**没人收尾**——行还在
（SQLite 在持久卷上），但它永远停在 pending/running：

  * 前端据此一直轮询转圈，用户看不出发生了什么；
  * sheets 那边的并发保护会因此拒绝重新识别，等于把那张图**锁死**，只能删掉重传。

丢的从来不是状态（状态一直在库里），是**执行**。所以要补的是启动时的一次收尾，
不是持久化。
"""

from datetime import UTC, datetime

import pytest

from app.db import get_sessionmaker, init_db
from app.models import PatternJob, Sheet, User


@pytest.fixture()
def session(app):
    with get_sessionmaker()() as s:
        s.add(User(username="u", password_hash="x"))
        s.commit()
        yield s


def _sheet(session, status: str) -> int:
    s = Sheet(user_id=1, image="a.png", width=1, height=1, status=status)
    session.add(s)
    session.commit()
    return s.id


def _job(session, status: str) -> int:
    j = PatternJob(user_id=1, status=status)
    session.add(j)
    session.commit()
    return j.id


@pytest.mark.parametrize("status", ["pending", "running"])
def test_an_interrupted_sheet_becomes_failed(session, status):
    sid = _sheet(session, status)
    init_db()                      # 相当于容器重启后再起一次应用
    session.expire_all()
    got = session.get(Sheet, sid)
    assert got.status == "failed"
    assert "重启" in got.error
    assert got.finished_at is not None


@pytest.mark.parametrize("status", ["pending", "running"])
def test_an_interrupted_pattern_job_becomes_failed(session, status):
    jid = _job(session, status)
    init_db()
    session.expire_all()
    got = session.get(PatternJob, jid)
    assert got.status == "failed"
    assert "重启" in got.error
    assert got.finished_at is not None


def test_a_sheet_waiting_for_the_user_is_left_alone(session):
    """ready = 传完了在等用户确认网格，根本没有线程在跑，不该被判失败。"""
    sid = _sheet(session, "ready")
    init_db()
    session.expire_all()
    assert session.get(Sheet, sid).status == "ready"


@pytest.mark.parametrize("status", ["done", "failed"])
def test_finished_rows_are_untouched(session, status):
    sid = _sheet(session, status)
    jid = _job(session, status)
    init_db()
    session.expire_all()
    assert session.get(Sheet, sid).status == status
    assert session.get(Sheet, sid).error == ""
    assert session.get(PatternJob, jid).status == status


def test_a_finished_time_is_not_overwritten(session):
    """已完成的行有自己的 finished_at，收尾不能把它抹掉。"""
    when = datetime(2020, 1, 1, tzinfo=UTC)
    s = Sheet(user_id=1, image="a.png", width=1, height=1, status="done",
              finished_at=when)
    session.add(s)
    session.commit()
    init_db()
    session.expire_all()
    assert session.get(Sheet, s.id).finished_at.replace(tzinfo=UTC) == when


def test_the_sheet_can_be_recognised_again_afterwards(session, client):
    """收尾的**目的**就是这个：卡住的图纸能重来，不必删掉重传。

    并发保护只挡 pending/running，所以行一旦被标成 failed，重新识别就通了。
    """
    from sqlalchemy import select

    from tests.conftest import XRW
    from tests.test_sheets_api import _set_vip

    client.post("/api/auth/register",
                json={"username": "vip", "password": "password123"}, headers=XRW)
    _set_vip("vip")
    # 图纸必须属于**登录的那个**用户，否则 _own 直接判 404，测不到 409
    me = session.scalar(select(User).where(User.username == "vip"))
    s = Sheet(user_id=me.id, image="a.png", width=1, height=1, status="running")
    session.add(s)
    session.commit()
    sid = s.id
    body = {"rect": [0, 0, 10, 10], "rows": 2, "cols": 2,
            "has_blanks": False, "palette": "221"}
    # 收尾之前：被并发保护挡住
    assert client.post(f"/api/sheets/{sid}/recognise", json=body,
                           headers=XRW).status_code == 409
    init_db()
    # 收尾之后：能重来（图片没了会是 404，但至少不再是 409）
    assert client.post(f"/api/sheets/{sid}/recognise", json=body,
                           headers=XRW).status_code != 409
