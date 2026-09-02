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

    index: int
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
