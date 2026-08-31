from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import User
from app.security import SESSION_COOKIE, read_token


def get_current_user(request: Request, session: Session = Depends(get_session)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    user_id = read_token(token) if token else None
    if user_id is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return user
