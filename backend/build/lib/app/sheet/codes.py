"""把 OCR 读出来的串对到色卡上，或者明确地拒绝。

色号的形状是「字母开头 + 数字」，所以同一个形近字符在首位和在尾部要往相反的方向
翻译：首位的 8 只能是 B，尾部的 B 只能是 8。
"""

import re

#: 首位：数字 → 它可能是哪些字母
TO_LETTER = {"0": "ODQ", "1": "IL", "2": "Z", "3": "E", "4": "A", "5": "S",
             "6": "GC", "7": "T", "8": "B", "9": "P"}

#: 序号位：字母 → 它可能是哪个数字
TO_DIGIT = {"O": "0", "D": "0", "Q": "0", "U": "0", "I": "1", "L": "1", "J": "1",
            "Z": "2", "E": "3", "A": "4", "S": "5", "G": "6", "T": "7", "Y": "7",
            "B": "8", "P": "9", "R": "8"}


def normalise(raw: str | None) -> str:
    """去掉一切非字母数字，转大写。"""
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def coerce(s: str) -> list[str]:
    """把每个字符翻到它所在位置该在的那一边，返回全部可能的修复。

    一进多出：首位的一个数字可能对应好几个形近字母。
    """
    if not s:
        return []
    heads = TO_LETTER.get(s[0], s[0]) if s[0].isdigit() else s[0]
    tail = "".join(TO_DIGIT.get(c, c) if c.isalpha() else c for c in s[1:])
    return [h + tail for h in heads]


def candidates(raw: str | None, valid) -> list[str]:
    """这次读数支持的色号，最好的在前。

    三种结果，重要的是第三种：

      串本身就是色号            -> 就是它
      恰好一种修复是色号        -> 是它，但排名靠后
      多种修复都是色号，或没有  -> 什么都不返回

    拒绝有歧义的修复是这里的全部意义。在两个都说得通的色号里挑一个，就是把
    「我看不出来」变成了一个自信的错答案，而红色告警存在的理由正是避免这个。
    """
    s = normalise(raw)
    if not s:
        return []
    if s in valid:
        return [s]
    fixed = sorted({c for c in coerce(s) if c in valid})
    return fixed if len(fixed) == 1 else []
