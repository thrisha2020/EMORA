"""TTS + the JARVIS automation endpoint."""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.dependencies import get_current_user
from backend.app.models import Interaction, User
from backend.app.services import tts_service
from backend.app.services.chat_service import get_reply, try_action
from backend.app.services.llm_service import LLMError
from backend.app.services.mood_service import trend_summary

router = APIRouter()


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    rate: Optional[str] = None


class AssistantRequest(BaseModel):
    message: str
    emotion: Optional[str] = None


class AssistantResponse(BaseModel):
    reply: str
    action: bool = False


@router.post("/tts")
async def tts(req: TTSRequest):
    """Speak `text` aloud. Returns MP3 bytes."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")
    try:
        audio = await tts_service.synthesize(
            req.text,
            voice=req.voice or tts_service.VOICE,
            rate=req.rate or tts_service.RATE,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}")
    if not audio:
        raise HTTPException(status_code=502, detail="TTS returned no audio")
    return Response(
        content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"}
    )


@router.post("/assistant", response_model=AssistantResponse)
def assistant(
    req: AssistantRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Whitelisted OS action first; otherwise a normal reply from the active provider."""
    reply = try_action(db, user.id, req.message)
    acted = reply is not None

    if reply is None:
        try:
            reply = get_reply(
                db,
                user_id=user.id,
                user_message=req.message,
                user_name=user.name,
                mood_trend=trend_summary(db, user.id),
            )
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
        )
    )
    db.commit()

    return AssistantResponse(reply=reply, action=acted)
