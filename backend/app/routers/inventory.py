from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import effective_codes
from app.db import get_session
from app.deps import get_current_user
from app.models import InventoryItem, User
from app.schemas import (
    BatchIn,
    BatchLineResult,
    BatchOut,
    ChangeRow,
    ChangesOut,
    CheckIn,
    CheckLineResult,
    CheckOut,
    InventoryRow,
    QuantityIn,
    StockoutItem,
    StockoutOut,
)
from app.service import load_inventory, record, rematerialize
from app.text_parse import parse_lines

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


@router.post("/inventory/batch", response_model=BatchOut)
def batch(
    body: BatchIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> BatchOut:
    known = effective_codes(session, user.id)
    results: list[BatchLineResult] = []
    for p in parse_lines(body.text):
        status, message = p.status, p.message
        if status == "ok" and p.code not in known:
            status, message = "code_not_found", f"色号 '{p.code}' 不存在"
        results.append(
            BatchLineResult(line=p.line_no, code=p.code, qty=p.qty, status=status, message=message)
        )

    if not results or any(r.status != "ok" for r in results):
        return BatchOut(ok=False, applied=False, results=results, changes=[])

    op_type = "batch_add" if body.mode == "add" else "batch_deduct"
    lines = [{"code": r.code, "qty": r.qty} for r in results]
    record(session, user.id, op_type, {"raw": body.text, "lines": lines})
    diff = rematerialize(session, user.id)
    session.commit()
    return BatchOut(
        ok=True,
        applied=True,
        results=results,
        changes=[ChangeRow(code=d["code"], from_=d["from"], to=d["to"]) for d in diff],
    )


@router.post("/inventory/check", response_model=CheckOut)
def check(
    body: CheckIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CheckOut:
    known = effective_codes(session, user.id)
    inv = load_inventory(session, user.id)
    results: list[CheckLineResult] = []
    for p in parse_lines(body.text):
        if p.status != "ok":
            results.append(
                CheckLineResult(line=p.line_no, code=p.code, need=None, have=None, status=p.status)
            )
            continue
        if p.code not in known:
            results.append(
                CheckLineResult(
                    line=p.line_no, code=p.code, need=p.qty, have=None, status="unknown_code"
                )
            )
            continue
        have = inv.get(p.code, 0)
        status = "enough" if have >= p.qty else "short"
        results.append(
            CheckLineResult(line=p.line_no, code=p.code, need=p.qty, have=have, status=status)
        )
    return CheckOut(results=results)


@router.get("/inventory/stockout", response_model=StockoutOut)
def stockout(
    user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> StockoutOut:
    inv = load_inventory(session, user.id)
    low = [(code, qty) for code, qty in inv.items() if qty < user.threshold]
    low.sort(key=lambda t: (t[1] >= 0, t[1], t[0]))
    items = [StockoutItem(code=c, quantity=q) for c, q in low]
    codes = [c for c, _ in low]
    return StockoutOut(codes=codes, text=",".join(codes), items=items)
