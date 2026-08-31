from sqlalchemy.orm import Session

from app.catalog import BASE, BASE_CODES, effective_catalog, effective_codes
from app.db import get_sessionmaker
from app.models import User, UserColor


def _user(session: Session) -> User:
    u = User(username="cat", password_hash="x")
    session.add(u)
    session.commit()
    return u


def test_base_catalog_loaded():
    assert len(BASE) == 291
    assert "A1" in BASE_CODES and "ZG8" in BASE_CODES


def test_effective_codes_includes_customs_only(app):
    with get_sessionmaker()() as s:
        u = _user(s)
        s.add_all(
            [
                UserColor(user_id=u.id, code="X1", hex="A03D2F", source="custom"),
                UserColor(user_id=u.id, code="C7", hex="9D5B3E", source="override"),
            ]
        )
        s.commit()
        codes = effective_codes(s, u.id)
    assert "X1" in codes
    assert "C7" in codes  # base, unaffected by override
    assert len(codes) == 291 + 1


def test_effective_catalog_applies_override_and_appends_custom(app):
    with get_sessionmaker()() as s:
        u = _user(s)
        s.add_all(
            [
                UserColor(user_id=u.id, code="C7", hex="9D5B3E", source="override"),
                UserColor(user_id=u.id, code="X1", hex="A03D2F", source="custom"),
            ]
        )
        s.commit()
        cat = effective_catalog(s, u.id)
    by_code = {c["code"]: c for c in cat}
    assert by_code["C7"]["hex"] == "9D5B3E"
    assert by_code["X1"] == {"code": "X1", "series": "X", "hex": "A03D2F"}
