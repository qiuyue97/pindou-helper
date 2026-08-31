from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import BASE_BY_CODE, BASE_CODES
from app.db import get_session
from app.deps import get_current_user
from app.models import User, UserColor
from app.schemas import ColorHexIn, ColorIn, ColorRow
from app.service import code_referenced

router = APIRouter()


def _row(uc: UserColor) -> ColorRow:
    base = BASE_BY_CODE.get(uc.code, {}).get("hex") if uc.source == "override" else None
    return ColorRow(code=uc.code, hex=uc.hex, source=uc.source, base_hex=base)


def _find(session: Session, user_id: int, code: str) -> UserColor | None:
    return session.scalar(
        select(UserColor).where(UserColor.user_id == user_id, UserColor.code == code)
    )


@router.get("/colors", response_model=list[ColorRow])
def list_colors(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[ColorRow]:
    rows = session.scalars(
        select(UserColor).where(UserColor.user_id == user.id).order_by(UserColor.code)
    ).all()
    return [_row(r) for r in rows]


@router.post("/colors", response_model=ColorRow, status_code=201)
def add_color(
    body: ColorIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ColorRow:
    if body.code in BASE_CODES:
        raise HTTPException(
            status_code=409, detail="that code is a standard colour; PUT to override it"
        )
    if _find(session, user.id, body.code):
        raise HTTPException(status_code=409, detail="colour already exists")
    uc = UserColor(user_id=user.id, code=body.code, hex=body.hex, source="custom")
    session.add(uc)
    session.commit()
    return _row(uc)


@router.put("/colors/{code}", response_model=ColorRow)
def set_color(
    code: str,
    body: ColorHexIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ColorRow:
    existing = _find(session, user.id, code)
    now = datetime.now(UTC)
    if code in BASE_CODES:
        if existing:
            existing.hex = body.hex
            existing.updated_at = now
            uc = existing
        else:
            uc = UserColor(user_id=user.id, code=code, hex=body.hex, source="override")
            session.add(uc)
    elif existing and existing.source == "custom":
        existing.hex = body.hex
        existing.updated_at = now
        uc = existing
    else:
        raise HTTPException(status_code=404, detail=f"no colour {code}")
    session.commit()
    return _row(uc)


@router.delete("/colors/{code}", status_code=204)
def delete_color(
    code: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    uc = _find(session, user.id, code)
    if uc is None:
        raise HTTPException(status_code=404, detail=f"no colour {code}")
    if uc.source == "custom" and code_referenced(session, user.id, code):
        raise HTTPException(
            status_code=409, detail="colour is still used by inventory or history"
        )
    session.delete(uc)
    session.commit()
    return Response(status_code=204)
