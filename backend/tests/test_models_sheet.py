"""Sheet 表。

矩阵**不直接存**：它由 labels + classes[k].code + overrides 现推。这是两级操作能
成立的地基——改整类是改 classes[k].code（O(1)，一次生效几十上百格），改格子只往
overrides 写几条稀疏记录。存死矩阵的话，改一次整类要重写上万个元素。
"""

import pytest

from app.db import get_sessionmaker
from app.models import Sheet, User


@pytest.fixture()
def session(app):
    """app fixture 已经把库指到 tmp_path 并建好表。"""
    with get_sessionmaker()() as s:
        s.add(User(username="u", password_hash="x"))
        s.commit()
        yield s


def test_defaults_are_empty_not_null(session):
    s = Sheet(user_id=1, image="a/b.png", width=100, height=200)
    session.add(s)
    session.commit()
    session.refresh(s)
    assert s.status == "pending"
    assert s.rect == [] and s.labels == [] and s.classes == [] and s.counts == []
    assert s.overrides == {} and s.prior == {}
    assert s.palette == "221"
    assert s.has_blanks is False
    assert s.seen is False
    assert s.structured is True


def test_json_columns_round_trip(session):
    s = Sheet(user_id=1, image="x.png", width=1, height=1,
              labels=[0, 1, -1], overrides={"3,4": "H15"}, prior={"H15": 7},
              rect=[1.5, 2.5, 3.5, 4.5], snap_x=[1.0, 2.0])
    session.add(s)
    session.commit()
    session.expire_all()
    got = session.get(Sheet, s.id)
    assert got.labels == [0, 1, -1]
    assert got.overrides == {"3,4": "H15"}
    assert got.prior == {"H15": 7}
    assert got.rect == [1.5, 2.5, 3.5, 4.5]
    assert got.snap_x == [1.0, 2.0]


def test_a_big_label_array_survives(session):
    """104x104 = 10,816 个 int，存成 JSON 约 30KB。"""
    labels = list(range(10816))
    s = Sheet(user_id=1, image="x.png", width=1, height=1, labels=labels)
    session.add(s)
    session.commit()
    session.expire_all()
    assert session.get(Sheet, s.id).labels == labels
