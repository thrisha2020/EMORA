"""JWT issuing/verification for EMORA AI.

HS256 tokens carry the user id and a 7-day expiry. The signing secret comes
from backend.app.config (SECRET_KEY in .env). The `sessions` table is still
written at login/register for audit/logout bookkeeping.
"""

import datetime

import jwt

from backend.app.config import SECRET_KEY

ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_DAYS = 7

# PyJWT warns when HMAC keys are shorter than 32 bytes; pad short dev secrets.
_SIGNING_KEY: str = SECRET_KEY
if len(_SIGNING_KEY.encode()) < 32:
    _SIGNING_KEY = _SIGNING_KEY + ("emora-pad" * 4)


def create_token(user_id: int, session_id: int | None = None) -> str:
    """`sid` ties the token to a row in `sessions`, so logout can revoke it."""
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + datetime.timedelta(days=ACCESS_TOKEN_TTL_DAYS),
    }
    if session_id is not None:
        payload["sid"] = session_id
    return jwt.encode(payload, _SIGNING_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, _SIGNING_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
