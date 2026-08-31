from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import effective_codes
from app.db import get_session
from app.deps import get_current_user
from app.models import InventoryItem, User
from app.schemas import ChangeRow, ChangesOut, InventoryRow, QuantityIn
from app.service import load_inventory, record, rematerialize

router = APIRouter()


def _changes_out(diff: list[dict]) -> ChangesOut:
    return ChangesOut(
        changes=[ChangeRow(code=d["code"], from_=d["from"], to=d["to"]) for d in diff]
    )


@router.get("/inventory", response_model=list[InventoryRow])
def list_inventory(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> list[InventoryItem]:
    rows = session.scalars(
        select(InventoryItem)
        .where(InventoryItem.user_id == user.id)
        .order_by(InventoryItem.code)
    ).all()
    return list(rows)


@router.put("/inventory/{code}", response_model=ChangesOut)
def set_quantity(
    code: str,
    body: QuantityIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChangesOut:
    if code not in effective_codes(session, user.id):
        raise HTTPException(status_code=422, detail=f"unknown colour code: {code}")
    current = load_inventory(session, user.id)
    op_type = "set" if code in current else "add_code"
    record(session, user.id, op_type, {"code": code, "qty": body.quantity})
    diff = rematerialize(session, user.id)
    session.commit()
    return _changes_out(diff)


@router.delete("/inventory/{code}", response_model=ChangesOut)
def delete_code(
    code: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChangesOut:
    if code not in load_inventory(session, user.id):
        raise HTTPException(status_code=404, detail=f"no inventory row for {code}")
    record(session, user.id, "delete", {"code": code})
    diff = rematerialize(session, user.id)
    session.commit()
    return _changes_out(diff)
