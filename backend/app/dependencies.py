"""FastAPI dependencies — auth + DB access.

`get_current_user` validates the `Authorization: Bearer <jwt>` header and
returns the User row, or raises 401 (missing / invalid / expired / unknown).
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import Session as SessionModel, User
from backend.app.services.jwt_service import decode_token

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None:
        raise unauthorized

    payload = decode_token(creds.credentials)
    if payload is None or "sub" not in payload:
        raise unauthorized

    # Tokens issued at login carry `sid`; a signed-out session is refused here.
    # Tokens minted before this existed have no `sid` and stay valid until they
    # expire — they simply can't be revoked.
    sid = payload.get("sid")
    if sid is not None:
        session = db.get(SessionModel, int(sid))
        if session is None or not session.is_active:
            raise unauthorized

    user = db.get(User, int(payload["sub"]))
    if user is None:
        raise unauthorized
    return user


def get_session_id(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> int | None:
    """The `sid` claim of the caller's token, if it has one. Used by logout."""
    if creds is None:
        return None
    payload = decode_token(creds.credentials)
    return payload.get("sid") if payload else None
