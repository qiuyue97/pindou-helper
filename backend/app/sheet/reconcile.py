"""把「已识别出来的」和「图纸图例上写的」摆在一起。

图例给的数是**先验**：它是关于这张图的一个说法，不是对它的权威。它不会改任何一个
格子的答案，只会在两份证据不一致时把那个色号整体标出来，让用户去看。

术语（界面上就用这两个词）：

    图纸数量    图例上印着的数，也就是先验。用户可以改——改的是「图纸说有多少」
    已识别数量  当前分在这个色号下的格子数。数出来的事实，只能靠改格子改变
"""

from dataclasses import dataclass, field

from app.sheet.decide import RANK, ClassRecord, intrinsic_level
from app.text_parse import code_key


@dataclass
class CountRow:
    code: str
    #: 已识别数量：当前分在这个色号下有多少格
    sheet: int
    #: 图纸数量：图例上写的。None = 图例里根本没有这个色号
    prior: int | None
    classes: list[int] = field(default_factory=list)
    level: str = "ok"
    #: 图例里没有、用户自己改出来的色号。
    #:
    #: 判据是干净的：识别时 `decide` 把答案限制在先验内（读出的色号不在先验里就
    #: 退回颜色兜底，而兜底也只在先验里挑），所以**只要有先验，识别刚结束时每个
    #: 色号必然都在先验里**。之后再冒出来的、不在先验里的色号，只可能是用户改的。
    #:
    #: 这类不算「数量对不上」——图例本来就没提它，那是预期的，标绿即可。
    custom: bool = False


def reconcile(records: list[ClassRecord], prior: dict | None,
              counted: dict[str, int] | None = None) -> list[CountRow]:
    """按色号汇总，并把对不上的色号整体提级到 `count`。

    **就地修改** `records` 的 level，同时返回对账表的行。每一类的级别都先回到
    `intrinsic_level`（它自己的证据），再按这一次的数量重新决定要不要提到
    `count`。不这样做的话 `count` 只进不出：用户把数量改对了，红色感叹号还在，
    因为下一次对账读的是上一次写进去的 `count`。

    `counted` 是逐格覆盖之后的真实格子数（`matrix.tally` 算的）。不给的话按类的
    格子数算——那是识别刚结束、还没有人工修改时的情形。给了就以它为准：用户改过
    格子之后，类的格子数就不再等于该色号实际占的格子数了。

    没有先验时不做对账——AI 抽取失败不等于「全都对不上」，只是没有第二份证据。

    数量不符时把该色号的**全部**格子标紫，而不是挑几个：如果 H15 多了三个而 H20
    少了三个，那么每一个 H15 格子都是嫌疑人，全标出来才是对证据的诚实读法。
    """
    by_code: dict[str, list[ClassRecord]] = {}
    for r in records:
        by_code.setdefault(r.code, []).append(r)

    codes = set(by_code) | set(prior or {}) | set(counted or {})
    rows: list[CountRow] = []
    for code in sorted(codes, key=code_key):
        group = by_code.get(code, [])
        sheet_n = (counted.get(code, 0) if counted is not None
                   else sum(r.n for r in group))
        row = CountRow(
            code=code,
            sheet=sheet_n,
            prior=(prior or {}).get(code) if prior else None,
            classes=[r.klass for r in group],
            custom=bool(prior) and code not in prior,
        )
        # 每一类先回到它自己的级别——上一轮对账打的 count 不能留到这一轮
        for r in group:
            r.level = intrinsic_level(r)
        # 该色号名下最严重的那个类的级别代表这一行
        row.level = max((r.level for r in group), key=lambda x: RANK[x],
                        default="ok")
        # 只有在真有第二份证据、且这个色号本来就在图例里时，才判「对不上」。
        # 用户自建的色号图例里没有，那是预期的，不该报警。
        if prior is not None and not row.custom and row.prior != row.sheet:
            row.level = "count"
            for r in group:
                if RANK["count"] > RANK[r.level]:
                    r.level = "count"
        rows.append(row)
    # 数量对不上的排在前面，两组各自按色号顺序（A2 在 A10 前）。用户是照着这一栏
    # 逐个核对的，要看的东西必须在最上面，不该在几十行里翻。
    #
    # 判据用的是 count，不是「level 不为 ok」。左栏只标两样东西：数量对不上（红色
    # 感叹号）和用户自建（绿色勾）——warn/guess 在这一栏里根本没有标记，真实图纸上
    # 又几乎每一类都够得上 warn（印刷色和目录色差 5 个 dE00 太常见）。按看不见的
    # 属性排序，用户只会看到顺序莫名其妙地变了。
    rows.sort(key=lambda r: (r.level != "count", code_key(r.code)))
    return rows
