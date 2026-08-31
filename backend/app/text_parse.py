import re
from dataclasses import dataclass

_QTY_RE = re.compile(r"^\d+$")


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
