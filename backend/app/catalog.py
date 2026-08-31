import json
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UserColor

_PATH = Path(__file__).with_name("catalog.json")
BASE: list[dict] = json.loads(_PATH.read_text(encoding="utf-8"))
BASE_BY_CODE: dict[str, dict] = {c["code"]: c for c in BASE}
BASE_CODES: frozenset[str] = frozenset(BASE_BY_CODE)


def _series_of(code: str) -> str:
    m = re.match(r"^[A-Za-z]+", code)
    return m.group(0).upper() if m else "自定义"


def effective_codes(session: Session, user_id: int) -> set[str]:
    customs = session.scalars(
        select(UserColor.code).where(
            UserColor.user_id == user_id, UserColor.source == "custom"
        )
    ).all()
    return set(BASE_CODES) | set(customs)


def effective_catalog(session: Session, user_id: int) -> list[dict]:
    rows = session.scalars(select(UserColor).where(UserColor.user_id == user_id)).all()
    overrides = {r.code: r.hex for r in rows if r.source == "override"}
    customs = [r for r in rows if r.source == "custom"]

    out = [
        {"code": c["code"], "series": c["series"], "hex": overrides.get(c["code"], c["hex"])}
        for c in BASE
    ]
    out.extend({"code": r.code, "series": _series_of(r.code), "hex": r.hex} for r in customs)
    return out
