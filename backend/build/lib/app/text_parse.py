import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

_QTY_RE = re.compile(r"^\d+$")

# The wildcard code a user can type to mean "every colour in the chosen scope".
# It parses as an ordinary code; only validation and expansion treat it specially.
# Case does not matter: parse_lines() upper-cases every code token, so "all"
# and "All" arrive here as ALL.
ALL_CODE = "ALL"

# A series wildcard: "A*" means every A-series colour in the chosen scope.
# Same story as ALL — it parses as an ordinary code and only expansion cares.
_SERIES_WILDCARD_RE = re.compile(r"^([A-Za-z]+)\*$")

_SERIES_PREFIX_RE = re.compile(r"^[A-Za-z]+")


def series_of(code: str) -> str:
    """The leading letters of a code, upper-cased. "" when it has none."""
    m = _SERIES_PREFIX_RE.match(code)
    return m.group(0).upper() if m else ""


def code_key(code: str) -> tuple[str, int, str]:
    """按色号本身的顺序排：先系列 A-Z，再序号升序。

    不能直接拿字符串排——那样 A10 会排在 A2 前面。用户是对着一盒按系列和序号
    摆好的豆子看这张表的，顺序对不上就得一行一行找。
    """
    m = re.match(r"^([A-Za-z]*)(\d*)(.*)$", code.strip())
    if not m:
        return (code.upper(), 0, "")
    series, num, rest = m.groups()
    return (series.upper(), int(num) if num else 0, rest.upper())


def series_wildcard(code: str | None) -> str | None:
    """The series a wildcard code targets, or None when it is not one."""
    if not code:
        return None
    m = _SERIES_WILDCARD_RE.match(code)
    return m.group(1).upper() if m else None


def is_wildcard(code: str | None) -> bool:
    return code == ALL_CODE or series_wildcard(code) is not None


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


def expand_wildcard(code: str, scope: Sequence[str]) -> list[str] | None:
    """The codes a wildcard covers, or None when `code` is not a wildcard.

    `scope` is the ordered in-scope catalogue, so 221/291 and "include my own
    colours" are already applied by the caller and never re-decided here.
    """
    if code == ALL_CODE:
        return list(scope)
    series = series_wildcard(code)
    if series is None:
        return None
    return [c for c in scope if series_of(c) == series]


def expand_lines(
    pairs: Iterable[tuple[str, int]], all_codes: Sequence[str]
) -> list[dict]:
    """Expand any wildcard row (ALL or A*) into one row per code, in place.

    Order is preserved so a later explicit row still accumulates on top of the
    wildcard (``ALL,100`` then ``A1,50`` leaves A1 at +150).
    """
    out: list[dict] = []
    for code, qty in pairs:
        expanded = expand_wildcard(code, all_codes)
        if expanded is None:
            out.append({"code": code, "qty": qty})
        else:
            out.extend({"code": c, "qty": qty} for c in expanded)
    return out
