"""Face enrollment and login.

Login is name-first: the client sends the spoken name to `/auth/identify`, then
posts a silently-captured frame to `/login` with that name. Unknown names route
to `/register`, which the UI offers as an inline enrollment step.
"""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.camera import bytes_to_frame
from backend.app.database import get_db
from backend.app.dependencies import get_current_user, get_session_id
from backend.app.models import Session as SessionModel, User
from backend.app.services.face_service import SpoofDetected, recognize_face, register_face
from backend.app.services.jwt_service import create_token
from backend.app.services.session_service import create_session

router = APIRouter()


class IdentifyRequest(BaseModel):
    name: str


def _auth_payload(db: Session, user_id: int, name: str) -> dict:
    session = create_session(db, user_id)
    return {
        "user_id": user_id,
        "name": name,
        "token": create_token(user_id, session.id),
        "session_id": session.id,
    }


def _read_frame(file: UploadFile):
    image_bytes = file.file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file")
    frame = bytes_to_frame(image_bytes)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image data")
    return frame


@router.post("/logout")
def logout(
    user: Annotated[User, Depends(get_current_user)],
    session_id: Annotated[int | None, Depends(get_session_id)],
    db: Session = Depends(get_db),
):
    """Revoke this session's token. Tokens issued before `sid` existed can't be revoked."""
    revoked = False
    if session_id is not None:
        session = db.get(SessionModel, int(session_id))
        if session is not None and session.user_id == user.id:
            session.is_active = 0
            db.commit()
            revoked = True
    return {"revoked": revoked}


@router.post("/auth/identify")
def identify(req: IdentifyRequest, db: Session = Depends(get_db)):
    """Is this name enrolled? Drives whether the UI verifies or offers enrollment."""
    name = req.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Name is too short")
    user = (
        db.query(User)
        .filter(func.lower(User.name) == name.lower(), User.face_embedding.isnot(None))
        .first()
    )
    return {
        "known": user is not None,
        "name": user.name if user else name,
        "enrolled_count": db.query(User).filter(User.face_embedding.isnot(None)).count(),
    }


@router.post("/register")
def register(
    name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if len(name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Name is too short")
    frame = _read_frame(file)
    try:
        result = register_face(db, name.strip(), frame)
    except SpoofDetected as e:
        raise HTTPException(status_code=401, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    auth = _auth_payload(db, result["user_id"], result["name"])
    return {"user_id": auth["user_id"], "name": auth["name"], "token": auth["token"]}


@router.post("/login")
def login(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    frame = _read_frame(file)
    try:
        result = recognize_face(db, frame, name=name)
    except SpoofDetected as e:
        raise HTTPException(status_code=401, detail=str(e))

    if result is None:
        raise HTTPException(status_code=404, detail="No users enrolled yet")
    if "error" in result:
        if "best_distance" in result:
            who = f" as {name}" if name else ""
            detail = (
                f"Face didn't match{who} (distance {result['best_distance']:.2f}, "
                f"threshold {result['threshold']})"
            )
        else:
            detail = result["error"]
        raise HTTPException(status_code=401, detail=detail)

    auth = _auth_payload(db, result["user_id"], result["name"])
    return {"user_id": auth["user_id"], "name": auth["name"], "token": auth["token"]}
