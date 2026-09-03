"""矩阵、统计，以及两种编辑的落点。

矩阵是**推出来的**，不是存下来的：`labels` 说每格属于哪个颜色类，`classes[k].code`
说那个类是什么色号，`overrides` 是人工挑出来的例外。

这样一来两级操作各有各的落点，互不干扰：

    改整类  ->  classes[k]["code"]        O(1)，一次生效几十上百格
    改格子  ->  overrides["r,c"]          稀疏，只存改过的

顺序也重要：override 覆盖 class，所以用户手工挑出来的那几格不会被后来的整类修改
冲掉——那是他自己的决定。
"""

from app.text_parse import code_key


def code_at(labels, classes, overrides, r: int, c: int, cols: int) -> str:
    """某一格最终是什么色号。空格（label -1）返回空串。"""
    key = f"{r},{c}"
    if key in overrides:
        return overrides[key]
    i = r * cols + c
    if i >= len(labels):
        return ""
    k = labels[i]
    if k < 0:
        return ""
    for cl in classes:
        if cl["klass"] == k:
            return cl.get("code", "")
    return ""


def matrix(labels, classes, overrides, rows: int, cols: int) -> list[list[str]]:
    by_k = {c["klass"]: c.get("code", "") for c in classes}
    out = []
    for r in range(rows):
        row = []
        for c in range(cols):
            key = f"{r},{c}"
            if key in overrides:
                row.append(overrides[key])
                continue
            i = r * cols + c
            k = labels[i] if i < len(labels) else -1
            row.append(by_k.get(k, "") if k >= 0 else "")
        out.append(row)
    return out


def tally(labels, classes, overrides, rows: int, cols: int) -> dict[str, int]:
    """有效矩阵上每个色号有多少格。空格不计。"""
    out: dict[str, int] = {}
    for row in matrix(labels, classes, overrides, rows, cols):
        for code in row:
            if code:
                out[code] = out.get(code, 0) + 1
    return out


def bead_list(counts: dict[str, int]) -> str:
    """「按图扣减」输入框要的格式：每行 `色号, 数量`。

    按色号顺序排，不按字符串排——那样 A10 会跑到 A2 前面，用户拿到手还得自己重排。
    """
    return "\n".join(f"{c}, {counts[c]}" for c in sorted(counts, key=code_key))


def apply_class_patch(classes: list[dict], patches) -> list[dict]:
    """改某几个类的色号。返回新列表，不改入参。"""
    out = [dict(c) for c in classes]
    by_k = {c["klass"]: c for c in out}
    for p in patches:
        k = int(p["k"])
        if k not in by_k:
            raise ValueError(f"没有第 {k} 个颜色类")
        by_k[k]["code"] = str(p["code"]).strip().upper()
    return out


def apply_recode(classes: list[dict], overrides: dict,
                 code: str, to: str) -> tuple[list[dict], dict]:
    """把色号 `code` 整体改成 `to`：所有读作它的类，加上所有指向它的逐格覆盖。

    只改类是不够的。一个色号名下的格子有两个来源——类，和用户逐格改过来的覆盖。
    漏掉后者的话，把 C18 改成 C20 之后，那几个手工挪进 C18 的豆点会继续显示成
    C18，界面上凭空多出一个谁都没要的色号。而当这一行**只有**覆盖、没有类时
    （图例里有、但一个都没识别出来的色号就是这样），只改类等于什么都没做。
    """
    code, to = code.strip().upper(), to.strip().upper()
    out = [dict(c) for c in classes]
    for c in out:
        if c["code"] == code:
            c["code"] = to
    moved = {k: (to if v == code else v) for k, v in overrides.items()}
    return out, moved


def apply_cell_patch(overrides: dict, patches, rows: int, cols: int) -> dict:
    """改某几格。`code` 为空表示撤销这一格的人工修正，回到它所属类的色号。"""
    out = dict(overrides)
    for p in patches:
        r, c = int(p["r"]), int(p["c"])
        if not (0 <= r < rows and 0 <= c < cols):
            raise ValueError(f"格子 ({r}, {c}) 超出 {rows}x{cols}")
        code = str(p.get("code") or "").strip().upper()
        if code:
            out[f"{r},{c}"] = code
        else:
            out.pop(f"{r},{c}", None)
    return out
