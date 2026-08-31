import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

USERNAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,32}$")


class AuthIn(BaseModel):
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
    username: str
    password: str


class AuthOut(BaseModel):
    username: str
    threshold: int


class SettingsIn(BaseModel):
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


class BatchIn(BaseModel):
    mode: Literal["add", "deduct"]
    text: str


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
