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


def require_vip(user: User = Depends(get_current_user)) -> User:
    """Gate a VIP-only endpoint.

    The flag is read from the database on every request, never from the client
    and never from the session token: `make_token()` stores only the user id, so
    there is nothing a caller could forge, and revoking VIP takes effect on the
    very next request instead of at the next login.

    Hiding a control in the UI is not access control — every VIP endpoint must
    depend on this, or it is reachable with a plain curl.
    """
    if not user.is_vip:
        raise HTTPException(status_code=403, detail="VIP only")
    return user
