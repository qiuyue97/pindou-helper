from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import get_current_user
from app.models import User
from app.schemas import AuthIn, AuthOut, LoginIn, SettingsIn, SettingsOut
from app.security import (
    clear_session_cookie,
    hash_password,
    make_token,
    set_session_cookie,
    verify_password,
)

router = APIRouter()


def _issue(resp: Response, user: User) -> AuthOut:
    set_session_cookie(resp, make_token(user.id))
    return AuthOut(username=user.username, threshold=user.threshold, is_vip=user.is_vip)


@router.post("/auth/register", response_model=AuthOut)
def register(body: AuthIn, resp: Response, session: Session = Depends(get_session)) -> AuthOut:
    exists = session.scalar(select(User).where(User.username == body.username))
    if exists:
        raise HTTPException(status_code=409, detail="username taken")
    user = User(username=body.username, password_hash=hash_password(body.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    return _issue(resp, user)


@router.post("/auth/login", response_model=AuthOut)
def login(body: LoginIn, resp: Response, session: Session = Depends(get_session)) -> AuthOut:
    user = session.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="bad credentials")
    return _issue(resp, user)


@router.post("/auth/logout", status_code=204)
def logout(resp: Response) -> None:
    clear_session_cookie(resp)


@router.get("/auth/me", response_model=AuthOut)
def me(user: User = Depends(get_current_user)) -> AuthOut:
    return AuthOut(username=user.username, threshold=user.threshold, is_vip=user.is_vip)


@router.patch("/settings", response_model=SettingsOut)
def patch_settings(
    body: SettingsIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SettingsOut:
    user.threshold = body.threshold
    session.add(user)
    session.commit()
    return SettingsOut(threshold=user.threshold)
