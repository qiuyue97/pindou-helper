from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog import effective_codes
from app.db import get_session
from app.deps import get_current_user
from app.models import Operation, User
from app.replay import OP_TYPES, iter_lines
from app.schemas import ChangeRow, ChangesOut, ImpactIn, OpEntry, OperationRow, OpPatchIn
from app.service import impact, rematerialize

router = APIRouter()

_LABELS = {
    "add_code": "添加色号",
    "set": "设置",
    "delete": "删除",
    "single_add": "补货",
    "single_deduct": "扣减",
    "batch_add": "批量补货",
    "batch_deduct": "批量扣减",
}


def _entries_of(op: Operation) -> list[OpEntry]:
    if op.type in ("add_code", "set"):
        return [OpEntry(code=op.payload["code"], kind="set", amount=int(op.payload["qty"]))]
    if op.type == "delete":
        return [OpEntry(code=op.payload["code"], kind="remove", amount=None)]
    kind = "add" if op.type.endswith("_add") else "deduct"
    return [OpEntry(code=c, kind=kind, amount=q) for c, q in iter_lines(op.type, op.payload)]


def _summary(op: Operation) -> str:
    label = _LABELS.get(op.type, op.type)
    parts = []
    for e in _entries_of(op):
        sign = "+" if e.kind == "add" else "-" if e.kind == "deduct" else "="
        amount = "" if e.amount is None else e.amount
        parts.append(f"{e.code} {sign}{amount}")
    return f"{label} " + ", ".join(parts)


def _row(op: Operation) -> OperationRow:
    return OperationRow(
        seq=op.seq,
        type=op.type,
        summary=_summary(op),
        entries=_entries_of(op),
        voided=op.voided,
        created_at=op.created_at,
        edited_at=op.edited_at,
        note=op.note,
    )


def _get_op(session: Session, user_id: int, seq: int) -> Operation:
    op = session.scalar(
        select(Operation).where(Operation.user_id == user_id, Operation.seq == seq)
    )
    if op is None:
        raise HTTPException(status_code=404, detail=f"no operation #{seq}")
    return op


def _changes_out(diff: list[dict]) -> ChangesOut:
    return ChangesOut(
        changes=[ChangeRow(code=d["code"], from_=d["from"], to=d["to"]) for d in diff]
    )


def _referenced(op_type: str, payload: dict) -> set[str]:
    if op_type.startswith("batch_"):
        return {line["code"] for line in payload["lines"]}
    return {payload["code"]}


@router.get("/operations", response_model=list[OperationRow])
def list_operations(
    limit: int = Query(50, ge=1, le=500),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[OperationRow]:
    ops = session.scalars(
        select(Operation)
        .where(Operation.user_id == user.id)
        .order_by(Operation.seq.desc())
        .limit(limit)
    ).all()
    return [_row(o) for o in ops]


@router.post("/operations/{seq}/void", response_model=ChangesOut)
def void_operation(
    seq: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> ChangesOut:
    _get_op(session, user.id, seq).voided = True
    diff = rematerialize(session, user.id)
    session.commit()
    return _changes_out(diff)


@router.post("/operations/{seq}/restore", response_model=ChangesOut)
def restore_operation(
    seq: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)
) -> ChangesOut:
    _get_op(session, user.id, seq).voided = False
    diff = rematerialize(session, user.id)
    session.commit()
    return _changes_out(diff)


@router.patch("/operations/{seq}", response_model=ChangesOut)
def patch_operation(
    seq: int,
    body: OpPatchIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChangesOut:
    op = _get_op(session, user.id, seq)
    new_type = body.type or op.type
    if new_type not in OP_TYPES:
        raise HTTPException(status_code=422, detail=f"bad operation type: {new_type}")
    if new_type != "delete":
        known = effective_codes(session, user.id)
        bad = _referenced(new_type, body.payload) - known
        if bad:
            raise HTTPException(status_code=422, detail=f"unknown colour code(s): {sorted(bad)}")
    op.type = new_type
    op.payload = body.payload
    op.edited_at = datetime.now(UTC)
    diff = rematerialize(session, user.id)
    session.commit()
    return _changes_out(diff)


@router.post("/operations/{seq}/impact", response_model=ChangesOut)
def operation_impact(
    seq: int,
    body: ImpactIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChangesOut:
    _get_op(session, user.id, seq)  # 404 if missing
    diff = impact(
        session, user.id, seq, mode=body.mode, new_type=body.type, new_payload=body.payload
    )
    return _changes_out(diff)
