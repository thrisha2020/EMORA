"""Emotion-aware chat endpoint."""

import base64
import json
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.dependencies import get_current_user
from backend.app.models import Interaction, User
from backend.app.services.chat_service import get_reply, try_action
from backend.app.services.llm_service import LLMError, VisionUnsupportedError
from backend.app.services.mood_service import maybe_create_nudge, trend_summary

router = APIRouter()

EMOTION_PROMPTS = {
    "happy": "They seem happy. Match their energy — warm, a little playful.",
    "sad": "They seem sad. Be gentle and supportive. Don't rush to fix things.",
    "angry": "They seem frustrated. Stay calm and de-escalating; acknowledge it without being defensive.",
    "fear": "They seem anxious. Be reassuring, concrete, and steady.",
    "surprise": "They seem surprised. Meet them with curiosity.",
    "disgust": "They seem put off by something. Be understanding and practical.",
    "neutral": "They seem level. Respond naturally.",
}


class ChatRequest(BaseModel):
    message: str
    emotion: Optional[str] = None
    confidence: Optional[float] = None
    scores: Optional[dict[str, float]] = None


class ChatResponse(BaseModel):
    reply: str
    action: bool = False
    nudge: Optional[str] = None
    saw_image: bool = False


MAX_IMAGE_BYTES = 4 * 1024 * 1024


def _emotion_context(emotion: str | None, confidence: float | None) -> str | None:
    if not emotion:
        return None
    text = EMOTION_PROMPTS.get(emotion.lower())
    if text is None:
        return None
    # Below this the reading is closer to a guess than a signal — don't let it
    # steer the reply's tone.
    if confidence is not None and confidence < 0.35:
        return None
    return text


def _run_chat(
    req: ChatRequest,
    user: User,
    db: Session,
    location: Optional[str] = None,
    image: Optional[tuple[str, str]] = None,
) -> ChatResponse:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message is required")

    history: list[dict] = []
    recent = (
        db.query(Interaction)
        .filter(Interaction.user_id == user.id)
        .order_by(Interaction.created_at.desc())
        .limit(10)
        .all()
    )
    for i in reversed(recent):
        history.append({"role": "user", "content": i.query_text})
        if i.response_text:
            history.append({"role": "assistant", "content": i.response_text})

    reply = try_action(db, user.id, req.message)
    acted = reply is not None

    if reply is None:
        try:
            reply = get_reply(
                db,
                user_id=user.id,
                user_message=req.message,
                history=history or None,
                user_name=user.name,
                emotion_context=_emotion_context(req.emotion, req.confidence),
                mood_trend=trend_summary(db, user.id),
                location=location,
                image=image,
            )
        except VisionUnsupportedError as e:
            # 400, not 503: the request is answerable, just not with this model.
            raise HTTPException(status_code=400, detail=str(e))
        except LLMError as e:
            raise HTTPException(status_code=503, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Provider error: {e}")

    db.add(
        Interaction(
            user_id=user.id,
            query_text=req.message,
            response_text=reply,
            emotion_label=req.emotion,
            emotion_confidence=req.confidence,
            emotion_vector=req.scores,
        )
    )
    db.commit()

    nudge = maybe_create_nudge(db, user.id)
    return ChatResponse(
        reply=reply,
        action=acted,
        nudge=nudge.title if nudge else None,
        saw_image=image is not None,
    )


@router.post("/chat", response_model=ChatResponse)
def chat(
    req: ChatRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Text-only chat."""
    return _run_chat(req, user, db)


@router.post("/chat/vision", response_model=ChatResponse)
def chat_with_vision(
    user: Annotated[User, Depends(get_current_user)],
    message: str = Form(...),
    emotion: Optional[str] = Form(None),
    confidence: Optional[float] = Form(None),
    scores: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    image: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    """Chat with a webcam frame attached, so Emora can answer about what she sees.

    Separate from /chat rather than making that endpoint multipart: the vast
    majority of turns carry no image, and a multipart body on every one of them
    would be pure overhead.
    """
    payload: Optional[tuple[str, str]] = None
    if image is not None:
        raw = image.file.read()
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Image too large (max 4 MB)")
        if raw:
            media_type = image.content_type or "image/jpeg"
            if media_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
                media_type = "image/jpeg"
            payload = (base64.standard_b64encode(raw).decode("ascii"), media_type)

    parsed_scores = None
    if scores:
        try:
            parsed_scores = json.loads(scores)
        except json.JSONDecodeError:
            parsed_scores = None

    req = ChatRequest(
        message=message, emotion=emotion, confidence=confidence, scores=parsed_scores
    )
    return _run_chat(req, user, db, location=location, image=payload)
