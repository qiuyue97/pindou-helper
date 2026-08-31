from collections.abc import Iterable, Iterator
from dataclasses import dataclass

OP_TYPES = frozenset(
    {"add_code", "set", "delete", "single_add", "single_deduct", "batch_add", "batch_deduct"}
)


@dataclass(frozen=True)
class ReplayOp:
    seq: int
    voided: bool
    type: str
    payload: dict


def iter_lines(op_type: str, payload: dict) -> Iterator[tuple[str, int]]:
    if op_type.startswith("batch_"):
        for line in payload["lines"]:
            yield line["code"], int(line["qty"])
    else:
        yield payload["code"], int(payload["qty"])


def apply_op(inv: dict[str, int], op_type: str, payload: dict) -> None:
    if op_type in ("add_code", "set"):
        inv[payload["code"]] = int(payload["qty"])
    elif op_type == "delete":
        inv.pop(payload["code"], None)
    elif op_type in ("single_add", "batch_add"):
        for code, qty in iter_lines(op_type, payload):
            inv[code] = inv.get(code, 0) + qty
    elif op_type in ("single_deduct", "batch_deduct"):
        for code, qty in iter_lines(op_type, payload):
            inv[code] = inv.get(code, 0) - qty
    else:
        raise ValueError(f"unknown operation type: {op_type}")


def replay(ops: Iterable[ReplayOp]) -> dict[str, int]:
    inv: dict[str, int] = {}
    for op in sorted(ops, key=lambda o: o.seq):
        if op.voided:
            continue
        apply_op(inv, op.type, op.payload)
    return inv


def diff_inventory(before: dict[str, int], after: dict[str, int]) -> list[dict]:
    out: list[dict] = []
    for code in sorted(before.keys() | after.keys()):
        b = before.get(code)
        a = after.get(code)
        if b != a:
            out.append({"code": code, "from": b, "to": a})
    return out


def referenced_codes(ops: Iterable[ReplayOp]) -> set[str]:
    codes: set[str] = set()
    for op in ops:
        if op.voided:
            continue
        if op.type.startswith("batch_"):
            codes.update(line["code"] for line in op.payload["lines"])
        else:
            codes.add(op.payload["code"])
    return codes
