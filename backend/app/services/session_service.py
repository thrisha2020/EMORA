from typing import Optional
import uuid
import datetime

from sqlalchemy.orm import Session

from backend.app.models import Session as SessionModel


def create_session(db: Session, user_id: int) -> SessionModel:
    token = str(uuid.uuid4())
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(days=7)
    session = SessionModel(
        user_id=user_id,
        token=token,
        expires_at=expires_at,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session_by_token(db: Session, token: str) -> Optional[SessionModel]:
    return (
        db.query(SessionModel)
        .filter(
            SessionModel.token == token,
            SessionModel.is_active == 1,
        )
        .first()
    )
