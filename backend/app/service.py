from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import InventoryItem, Operation
from app.replay import ReplayOp, diff_inventory, referenced_codes, replay


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _replay_ops(session: Session, user_id: int) -> list[ReplayOp]:
    ops = session.scalars(select(Operation).where(Operation.user_id == user_id)).all()
    return [ReplayOp(o.seq, o.voided, o.type, o.payload) for o in ops]


def next_seq(session: Session, user_id: int) -> int:
    mx = session.scalar(select(func.max(Operation.seq)).where(Operation.user_id == user_id))
    return (mx or 0) + 1


def record(
    session: Session, user_id: int, type_: str, payload: dict, note: str | None = None
) -> Operation:
    op = Operation(
        user_id=user_id, seq=next_seq(session, user_id), type=type_, payload=payload, note=note
    )
    session.add(op)
    session.flush()
    return op


def load_inventory(session: Session, user_id: int) -> dict[str, int]:
    rows = session.scalars(
        select(InventoryItem).where(InventoryItem.user_id == user_id)
    ).all()
    return {r.code: r.quantity for r in rows}


def rematerialize(session: Session, user_id: int) -> list[dict]:
    rows = {
        r.code: r
        for r in session.scalars(
            select(InventoryItem).where(InventoryItem.user_id == user_id)
        ).all()
    }
    before = {c: r.quantity for c, r in rows.items()}
    target = replay(_replay_ops(session, user_id))

    now = _now()
    for code, qty in target.items():
        row = rows.get(code)
        if row is None:
            session.add(InventoryItem(user_id=user_id, code=code, quantity=qty, updated_at=now))
        elif row.quantity != qty:
            row.quantity = qty
            row.updated_at = now
    for code, row in rows.items():
        if code not in target:
            session.delete(row)
    session.flush()
    return diff_inventory(before, target)


def impact(
    session: Session,
    user_id: int,
    seq: int,
    *,
    mode: str,
    new_type: str | None = None,
    new_payload: dict | None = None,
) -> list[dict]:
    base = _replay_ops(session, user_id)
    before = replay(base)
    hypo: list[ReplayOp] = []
    for o in base:
        if o.seq != seq:
            hypo.append(o)
        elif mode == "void":
            hypo.append(ReplayOp(o.seq, not o.voided, o.type, o.payload))
        else:  # "edit"
            hypo.append(
                ReplayOp(
                    o.seq,
                    o.voided,
                    new_type or o.type,
                    new_payload if new_payload is not None else o.payload,
                )
            )
    return diff_inventory(before, replay(hypo))


def code_referenced(session: Session, user_id: int, code: str) -> bool:
    has_row = session.scalar(
        select(InventoryItem.id).where(
            InventoryItem.user_id == user_id, InventoryItem.code == code
        )
    )
    if has_row:
        return True
    return code in referenced_codes(o for o in _replay_ops(session, user_id) if not o.voided)
