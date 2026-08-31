import re

from pydantic import BaseModel, field_validator

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
