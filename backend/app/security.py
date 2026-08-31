from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from fastapi import Response

from app.config import get_settings

SESSION_COOKIE = "session"
_ph = PasswordHasher()


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(stored_hash: str, pw: str) -> bool:
    try:
        return _ph.verify(stored_hash, pw)
    except Exception:  # noqa: BLE001 - any mismatch or malformed hash -> False
        return False


def make_token(user_id: int) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=s.jwt_days)}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def read_token(token: str) -> int | None:
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        return int(data["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def set_session_cookie(resp: Response, token: str) -> None:
    s = get_settings()
    resp.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=s.cookie_secure,
        path="/",
        max_age=s.jwt_days * 86400,
    )


def clear_session_cookie(resp: Response) -> None:
    resp.delete_cookie(SESSION_COOKIE, path="/")
