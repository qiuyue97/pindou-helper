"""把每个类的读数变成一个带把握程度的答案。

顺序是：文字优先，颜色其次，颜色兜底垫底。

  1  OCR 读出来的就是答案。颜色不推翻它——颜色只负责在两者不一致时举手。
  2  读不出来才拿类心色匹配最近的目录色，并且**以猜的身份**交付（标红）。

我们的色卡是色号↔颜色的权威。某张图把自己的色号印偏了是那个生成器的事实，
永远不能拿来「修正」目录。
"""

from dataclasses import asdict, dataclass, field

import numpy as np

from app.colour import Palette, delta_e00, srgb_to_lab

#: 类心色与「读出色号的目录色」的 dE00 超过它就橙色告警
WARN_DE = 5.0

LEVELS = ("ok", "warn", "count", "guess")

#: 多个同时成立时取最严重的。`count` 排在 `warn` 之上，因为只有它背后站着一份
#: **独立的第二证据**：图例说有 3 个 H20，pipeline 一个没产出，两者必有一个错。
RANK = {"ok": 0, "warn": 1, "count": 2, "guess": 3}


@dataclass
class ClassRecord:
    klass: int
    code: str
    source: str            # "ocr" | "guess"
    level: str
    de: float              # 类心色 vs code 的目录色
    n: int                 # 这一类有多少格
    radius: float
    rgb: list[int]
    nearest: str           # 纯按颜色最近的色号
    nearest_de: float
    read_full: str | None  # OCR 不受先验约束时的答案
    off_list: bool         # 上面那个和最终答案不一致
    dup: float | None = None   # 同码多类时，这些类心色两两 dE00 的最大值
    cells: list[int] = field(default_factory=list)  # 成员的扁平下标

    def as_dict(self) -> dict:
        """落库用。numpy 标量进不了 SQLite 的 JSON 列。"""
        return asdict(self)


def decide(stats, reads, palette: Palette, prior: dict | None = None,
           warn: float = WARN_DE) -> list[ClassRecord]:
    """逐类定案并定级。

    `stats[k]` 是 `ClassStat`，`reads[k]` 是 OCR 给出的色号或 None。
    `prior` 是 AI 抽取的图例 `{色号: 数量}`，可以是 None。
    """
    codes = palette.codes
    idx_of = {c: i for i, c in enumerate(codes)}
    # 颜色兜底也限制在先验内：猜一个这张图证明没有的色号帮不了任何人
    pal_idx = ([i for i, c in enumerate(codes) if c in prior] if prior
               else list(range(len(codes))))
    if not pal_idx:                       # 先验里一个色号都不在色卡里
        pal_idx = list(range(len(codes)))

    recs: list[ClassRecord] = []
    for k, st in enumerate(stats):
        read_full = reads[k]
        code = read_full
        # 先验收窄答案空间，但**不消灭**不受限的那个答案：两者不一致本身就是
        # 要给用户看的东西。
        if prior and code is not None and code not in prior:
            code = None
        near = pal_idx[int(delta_e00(st.centre_lab,
                                     palette.lab[pal_idx]).argmin())]
        if code is None:
            code, source = codes[near], "guess"
        else:
            source = "ocr"
        off_list = bool(read_full and read_full != code)
        de = float(delta_e00(st.centre_lab, palette.lab[idx_of[code]]))
        level = "guess" if source == "guess" else ("ok" if de <= warn else "warn")
        if off_list and level == "ok":
            level = "warn"
        recs.append(ClassRecord(
            klass=k, code=code, source=source, level=level, de=round(de, 2),
            n=len(st.order), radius=round(float(st.radius), 2),
            rgb=[round(v) for v in st.centre_rgb],
            nearest=codes[near],
            nearest_de=round(float(delta_e00(st.centre_lab,
                                             palette.lab[near])), 2),
            read_full=read_full, off_list=off_list,
            cells=[int(v) for v in st.order],
        ))

    # 同一个色号落在多个类上是**常态**——颜色的切口故意很紧，裂开是设计出来的
    # 预期结果，两个类独立读出同一个码反而是一致的证据。
    #
    # 唯一的例外：这些类彼此颜色差得很远。那时它们不可能是同一个色号，两个读数
    # 里至少有一个错了。
    by_code: dict[str, list[ClassRecord]] = {}
    for r in recs:
        by_code.setdefault(r.code, []).append(r)
    for group in by_code.values():
        if len(group) < 2:
            continue
        labs = srgb_to_lab(np.array([g.rgb for g in group], float))
        spread = float(delta_e00(labs[:, None, :], labs[None, :, :]).max())
        if spread > warn:
            for g in group:
                g.dup = round(spread, 2)
                if g.level == "ok":
                    g.level = "warn"
    return recs
