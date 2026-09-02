"""把「本图数出来的」和「AI 从图例读到的」摆在一起。

先验是关于这张图的一个说法，不是对它的权威。它不会改任何一个格子的答案，只会在
两份证据不一致时把那个色号整体标紫，让用户去看。
"""

from dataclasses import dataclass, field

from app.sheet.decide import RANK, ClassRecord
from app.text_parse import code_key


@dataclass
class CountRow:
    code: str
    sheet: int                       # 本图数出来多少格
    prior: int | None                # AI 说有多少；None = 图例里没有这个色号
    classes: list[int] = field(default_factory=list)
    level: str = "ok"


def reconcile(records: list[ClassRecord], prior: dict | None) -> list[CountRow]:
    """按色号汇总，并把对不上的色号整体提级到 `count`。

    **就地修改** `records` 的 level（只升不降），同时返回对账表的行。

    没有先验时不做对账——AI 抽取失败不等于「全都对不上」，只是没有第二份证据。

    数量不符时把该色号的**全部**格子标紫，而不是挑几个：如果 H15 多了三个而 H20
    少了三个，那么每一个 H15 格子都是嫌疑人，全标出来才是对证据的诚实读法。
    """
    by_code: dict[str, list[ClassRecord]] = {}
    for r in records:
        by_code.setdefault(r.code, []).append(r)

    codes = set(by_code) | set(prior or {})
    rows: list[CountRow] = []
    for code in sorted(codes, key=code_key):
        group = by_code.get(code, [])
        row = CountRow(
            code=code,
            sheet=sum(r.n for r in group),
            prior=(prior or {}).get(code) if prior else None,
            classes=[r.klass for r in group],
        )
        # 只有在真的有第二份证据时才判「对不上」
        if prior is not None and row.prior != row.sheet:
            row.level = "count"
            for r in group:
                if RANK["count"] > RANK[r.level]:
                    r.level = "count"
        else:
            # 该色号名下最严重的那个类的级别代表这一行
            row.level = max((r.level for r in group), key=lambda x: RANK[x],
                            default="ok")
        rows.append(row)
    return rows
