from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import effective_codes, scope_codes
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
from app.text_parse import expand_lines, expand_wildcard, is_wildcard, parse_lines

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
    parsed = parse_lines(body.text)

    # The in-scope catalogue is needed to VALIDATE a wildcard (does "A*" actually
    # cover anything here?), not just to expand it, so resolve it up front.
    scope: list[str] = (
        scope_codes(session, user.id, body.scope.set, body.scope.include_custom)
        if any(p.status == "ok" and is_wildcard(p.code) for p in parsed)
        else []
    )

    results: list[BatchLineResult] = []
    for p in parsed:
        status, message = p.status, p.message
        if status == "ok":
            covered = expand_wildcard(p.code, scope) if is_wildcard(p.code) else None
            if covered is not None:
                # A wildcard nobody matches is a typo ("X*"), not a no-op.
                if not covered:
                    status, message = "code_not_found", f"{p.code} 在当前范围内没有色号"
            elif p.code not in known:
                status, message = "code_not_found", f"色号 '{p.code}' 不存在"
        results.append(
            BatchLineResult(line=p.line_no, code=p.code, qty=p.qty, status=status, message=message)
        )

    if not results or any(r.status != "ok" for r in results):
        return BatchOut(ok=False, applied=False, results=results, changes=[])

    # Wildcards are expanded and FROZEN here, so an operation's effect can never
    # drift when the catalogue changes later. The scope is recorded alongside it
    # purely so the history can render "ALL(221)" instead of 221 separate entries.
    uses_wildcard = any(is_wildcard(r.code) for r in results)
    lines = expand_lines([(r.code, r.qty) for r in results], scope)  # type: ignore[arg-type]

    op_type = "batch_add" if body.mode == "add" else "batch_deduct"
    payload: dict = {"raw": body.text, "lines": lines}
    if uses_wildcard:
        payload["scope"] = {
            # "all" predates series wildcards but means exactly what is needed
            # here — a candidate set was frozen — so the stored format is left
            # alone rather than split across old and new rows.
            "kind": "all",
            "set": body.scope.set,
            "include_custom": body.scope.include_custom,
        }
    record(session, user.id, op_type, payload)
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
