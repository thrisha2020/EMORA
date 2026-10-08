"""Emotion detection endpoints: per-modality and fused."""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from backend.app.camera import bytes_to_frame
from backend.app.database import get_db
from backend.app.dependencies import get_current_user
from backend.app.models import EmotionLog, User
from backend.app.services.face_track_service import track as track_face
from backend.app.services.emotion_service import (
    analyze_face_emotion,
    analyze_text_sentiment,
    analyze_voice_emotion,
    fuse_emotions,
    smooth,
)

router = APIRouter()


def _log(db: Session, user: Optional[User], source: str, result: dict) -> None:
    if user is None:
        return
    db.add(
        EmotionLog(
            user_id=user.id,
            source=source,
            emotion=result["emotion"],
            confidence=result["confidence"],
        )
    )
    db.commit()


@router.post("/emotion/face")
def detect_face_emotion(
    file: UploadFile = File(...),
    user: Annotated[User, Depends(get_current_user)] = None,
    db: Session = Depends(get_db),
):
    image_bytes = file.file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file")
    frame = bytes_to_frame(image_bytes)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    result = analyze_face_emotion(frame)
    if result is None:
        raise HTTPException(
            status_code=422,
            detail="No face detected. Check lighting and face the camera.",
        )
    _log(db, user, "face", result)
    return result


@router.post("/emotion/voice")
def detect_voice_emotion(
    file: UploadFile = File(...),
    user: Annotated[User, Depends(get_current_user)] = None,
    db: Session = Depends(get_db),
):
    audio_bytes = file.file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    result = analyze_voice_emotion(audio_bytes)
    if result is None:
        raise HTTPException(status_code=422, detail="Could not decode audio")
    _log(db, user, "voice", result)
    return result


@router.post("/emotion/analyze")
def analyze_emotion(
    face: UploadFile | None = File(None),
    voice: UploadFile | None = File(None),
    text: str | None = Form(None),
    user: Annotated[User, Depends(get_current_user)] = None,
    db: Session = Depends(get_db),
):
    """Fuse whichever modalities were supplied into a single reading."""
    face_result = voice_result = text_result = None

    if face is not None:
        image_bytes = face.file.read()
        if image_bytes:
            frame = bytes_to_frame(image_bytes)
            if frame is not None:
                face_result = analyze_face_emotion(frame)

    if voice is not None:
        audio_bytes = voice.file.read()
        if audio_bytes:
            voice_result = analyze_voice_emotion(audio_bytes)

    if text:
        text_result = analyze_text_sentiment(text)

    fused = fuse_emotions(face_result, voice_result, text_result)
    if user is not None:
        fused = smooth(user.id, fused)

    fused["breakdown"] = {
        "face": face_result,
        "voice": voice_result,
        "text": text_result,
    }
    _log(db, user, "fused", fused)
    return fused


@router.post("/face/track")
def track_head_position(file: UploadFile = File(...)):
    """Where is the user's face in frame? Drives the avatar's gaze.

    Unauthenticated and unlogged on purpose: it is polled several times a second
    and carries no identity or emotion — only a coordinate. Keeping it off the
    DB path is what makes that poll rate affordable.
    """
    image_bytes = file.file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file")
    frame = bytes_to_frame(image_bytes)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    result = track_face(frame)
    if result is None:
        return {"found": False}
    return {"found": True, **result}
