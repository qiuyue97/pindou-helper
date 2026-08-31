import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

_QTY_RE = re.compile(r"^\d+$")

# The wildcard code a user can type to mean "every colour in the chosen scope".
# It parses as an ordinary code; only validation and expansion treat it specially.
ALL_CODE = "ALL"


def normalize(text: str) -> str:
    text = text.replace("，", ",").replace("　", " ")
    text = re.sub(r"\s*,\s*", ",", text)
    return text


@dataclass
class ParsedLine:
    line_no: int
    raw: str
    code: str | None
    qty: int | None
    status: str
    message: str


def parse_lines(text: str) -> list[ParsedLine]:
    out: list[ParsedLine] = []
    for i, raw in enumerate(normalize(text).split("\n"), start=1):
        stripped = raw.strip()
        if not stripped:
            continue
        tokens = [t for t in re.split(r"[,\s]+", stripped) if t]
        if len(tokens) != 2:
            out.append(ParsedLine(i, raw, None, None, "format_error", "应为 '色号,数量'"))
            continue
        code_tok, qty_tok = tokens
        if not _QTY_RE.match(qty_tok) or int(qty_tok) <= 0:
            out.append(
                ParsedLine(i, raw, code_tok.upper(), None, "bad_quantity", "数量应为正整数")
            )
            continue
        out.append(ParsedLine(i, raw, code_tok.upper(), int(qty_tok), "ok", ""))
    return out


def expand_lines(
    pairs: Iterable[tuple[str, int]], all_codes: Sequence[str]
) -> list[dict]:
    """Expand any ALL row into one row per code, in place.

    Order is preserved so a later explicit row still accumulates on top of the
    wildcard (``ALL,100`` then ``A1,50`` leaves A1 at +150).
    """
    out: list[dict] = []
    for code, qty in pairs:
        if code == ALL_CODE:
            out.extend({"code": c, "qty": qty} for c in all_codes)
        else:
            out.append({"code": code, "qty": qty})
    return out
