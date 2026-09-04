import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,32}$")


class AuthIn(BaseModel):
    # extra="forbid" so a client that tries to smuggle in a privileged field
    # (is_vip being the obvious one) gets a 422 instead of having it quietly
    # dropped. Privileges are never taken from a request body.
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        if not USERNAME_RE.match(v):
            raise ValueError("username must be 3-32 chars [A-Za-z0-9_-]")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str


class AuthOut(BaseModel):
    username: str
    threshold: int
    is_vip: bool = False


class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    threshold: int

    @field_validator("threshold")
    @classmethod
    def _threshold(cls, v: int) -> int:
        if v < 0:
            raise ValueError("threshold must be >= 0")
        return v


class SettingsOut(BaseModel):
    threshold: int


class InventoryRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    code: str
    quantity: int
    updated_at: datetime


class QuantityIn(BaseModel):
    quantity: int


class ChangeRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    code: str
    from_: int | None = Field(serialization_alias="from")
    to: int | None


class ChangesOut(BaseModel):
    changes: list[ChangeRow]


class BatchScope(BaseModel):
    set: Literal["221", "291"] = "291"
    include_custom: bool = True


class BatchIn(BaseModel):
    mode: Literal["add", "deduct"]
    text: str
    scope: BatchScope = BatchScope()


class BatchLineResult(BaseModel):
    line: int
    code: str | None
    qty: int | None
    status: str
    message: str


class BatchOut(BaseModel):
    ok: bool
    applied: bool
    results: list[BatchLineResult]
    changes: list[ChangeRow]


class CheckIn(BaseModel):
    text: str


class CheckLineResult(BaseModel):
    line: int
    code: str | None
    need: int | None
    have: int | None
    status: str


class CheckOut(BaseModel):
    results: list[CheckLineResult]


class StockoutItem(BaseModel):
    code: str
    quantity: int


class StockoutOut(BaseModel):
    codes: list[str]
    text: str
    items: list[StockoutItem]


class OpEntry(BaseModel):
    code: str
    kind: Literal["add", "deduct", "set", "remove"]
    amount: int | None


class OperationRow(BaseModel):
    seq: int
    type: str
    summary: str
    entries: list[OpEntry]
    scope_label: str | None = None
    raw: str | None = None
    voided: bool
    created_at: datetime
    edited_at: datetime | None
    note: str | None


class OpPatchIn(BaseModel):
    type: str | None = None
    payload: dict


class ImpactIn(BaseModel):
    mode: Literal["void", "edit"]
    type: str | None = None
    payload: dict | None = None


_COLOR_CODE_RE = re.compile(r"^[A-Z0-9_-]{1,12}$")
_HEX_RE = re.compile(r"^[0-9A-F]{6}$")


def _norm_hex(v: str) -> str:
    v = v.strip().lstrip("#").upper()
    if not _HEX_RE.match(v):
        raise ValueError("hex must be 6 hex digits")
    return v


class ColorRow(BaseModel):
    code: str
    hex: str
    source: str
    base_hex: str | None = None


class ColorIn(BaseModel):
    code: str
    hex: str

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = v.strip().upper()
        if not _COLOR_CODE_RE.match(v):
            raise ValueError("code must be 1-12 chars [A-Z0-9_-]")
        return v

    @field_validator("hex")
    @classmethod
    def _hex(cls, v: str) -> str:
        return _norm_hex(v)


class ColorHexIn(BaseModel):
    hex: str

    @field_validator("hex")
    @classmethod
    def _hex(cls, v: str) -> str:
        return _norm_hex(v)


class SmartExtractIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str


class SmartLine(BaseModel):
    code: str
    #: Signed: positive adds, negative deducts.
    delta: int
    source: str | None = None


class SmartExtractOut(BaseModel):
    lines: list[SmartLine] = []
    unresolved: list[str] = []
    #: 实际给出结果的模型，便于排查是哪一档降级生效了。
    model: str = ""


class PatternImageOut(BaseModel):
    """一张图的下场。前台用它把失败的那几张单独标出来。"""

    #: 用户上传时的序号，只用来排序和显示
    index: int
    #: 这张图在 job.images 里的位置，也就是 /api/patterns/{id}/images/{N} 的 N。
    #: 校验就没过的图没有存下原图，所以是 null——前端据此决定能不能点开看。
    image_index: int | None = None
    filename: str = ""
    #: ok | failed
    status: str = "ok"
    error: str = ""
    notes: list[str] = []


class PatternJobOut(BaseModel):
    id: int
    status: str
    bead_list: str = ""
    md_table: str = ""
    note: str = ""
    model: str = ""
    error: str = ""
    #: false = 图里没有可提取的色号统计区域，bead_list 为空
    extracted: bool = True
    seen: bool = False
    image_count: int = 0
    #: 逐图结果；整批成功时也在，方便前台显示"这张压缩过"之类的提醒
    items: list[PatternImageOut] = []
    created_at: datetime
    finished_at: datetime | None = None


class PatternJobSummary(BaseModel):
    jobs: list[PatternJobOut] = []
    #: 已完成但用户还没看过的数量——前台的红点就是它
    unseen: int = 0
    running: int = 0


# --- 图纸识别（VIP）---


class SheetGuessOut(BaseModel):
    """上传后立刻返回的初始猜测。

    rect/rows/cols 是给用户当起点的，snap_x/snap_y 是拖角时的吸附靶点。
    检测不到点阵时 snap 是空的、rect 给整图——那不是失败，用户自己拖框。
    """

    id: int
    width: int
    height: int
    rect: list[float] = []
    rows: int = 0
    cols: int = 0
    snap_x: list[float] = []
    snap_y: list[float] = []
    #: "lattice" = 自动检测到；"manual" = 没检测到，这些值只是整图的边界
    source: str = "manual"


class SheetOut(BaseModel):
    id: int
    #: 用户起的名字。空 = 没起过，前端显示 #id。
    name: str = ""
    #: 列表里的排序位。小的在前，同位按 id 倒序。
    position: int = 0
    status: str
    width: int
    height: int
    rect: list[float] = []
    rows: int = 0
    cols: int = 0
    has_blanks: bool = False
    palette: str = "221"
    snap_x: list[float] = []
    snap_y: list[float] = []
    labels: list[int] = []
    classes: list[dict] = []
    counts: list[dict] = []
    overrides: dict[str, str] = {}
    prior: dict[str, int] = {}
    engine: str = ""
    #: 识别进行到哪一步（给用户看的一句话）和 0-100 的进度。只在 running 期间有意义。
    step: str = ""
    progress: int = 0
    #: false = 这张图的填充色是一段连续谱而不是几十个分立的类，整张走了颜色兜底
    structured: bool = True
    error: str = ""
    seen: bool = False
    #: 有效矩阵上每个色号多少格，由 labels+classes+overrides 现推
    tally: dict[str, int] = {}
    created_at: datetime
    finished_at: datetime | None = None


class SheetSummary(BaseModel):
    sheets: list[SheetOut] = []
    running: int = 0


class SheetNameIn(BaseModel):
    """给图纸起名字。空字符串 = 取消命名，回到 #id。"""

    name: str = Field(default="", max_length=80)


class SheetOrderIn(BaseModel):
    """整份列表的新顺序。

    传的是**用户屏幕上那一份完整列表**，服务端按下标写回 position。只传被挪动的
    那一张是不够的：位置是相对的，两张图的先后关系没法从一条记录里读出来。
    """

    ids: list[int] = Field(min_length=1, max_length=200)


class RecogniseIn(BaseModel):
    """用户确认过的几何。下游 pipeline 只吃这几个数。"""

    rect: list[float] = Field(min_length=4, max_length=4)
    rows: int = Field(ge=1)
    cols: int = Field(ge=1)
    has_blanks: bool = False
    palette: Literal["221", "291"] = "221"


class GenerateIn(BaseModel):
    """用户框好的裁剪区 + 想要的豆阵尺寸。

    和 `RecogniseIn` 长得像但**不是一回事**：那边的 rect 是「图纸上的豆阵在哪」，
    这边的 rect 是「照片上我要哪一块」。这边也没有 has_blanks——生成出来的每一格
    都有豆子。
    """

    rect: list[float] = Field(min_length=4, max_length=4)
    rows: int = Field(ge=1)
    cols: int = Field(ge=1)
    palette: Literal["221", "291"] = "221"
    #: slic = 轮廓优先（格子边界顺着轮廓弯）；dpid = 细节优先（细密纹理留得住）
    style: Literal["slic", "dpid"] = "slic"
    #: 去掉四邻都不同的孤立单豆。它们视觉上是噪点，实物上还要单买一整包。
    clean: bool = True


class ClassPatch(BaseModel):
    k: int
    code: str


class ClassPatchIn(BaseModel):
    patches: list[ClassPatch] = Field(min_length=1)


class CellPatch(BaseModel):
    r: int
    c: int
    #: 空串 = 撤销这一格的人工修正，回到它所属类的色号
    code: str = ""


class CellPatchIn(BaseModel):
    patches: list[CellPatch] = Field(min_length=1)


class RecodeIn(BaseModel):
    """把一个色号整体改成另一个。

    左栏一行代表的是**一个色号**，不是一个颜色类：同一个色号常常落在两三个类上，
    而且用户逐格改过来的豆点根本不属于任何类。所以整体改色号必须按色号来，把这
    两边一起改掉。
    """

    code: str
    to: str


class PriorIn(BaseModel):
    """AI 抽取的图例，用户改过的版本。数量为 0 表示删掉这一行。"""

    prior: dict[str, int] = {}
