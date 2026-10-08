"""Provider/API-key management for the Settings page.

Keys are written encrypted and are never sent back to the browser — reads return
a mask (`sk-ant…9f2a`) only.
"""

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.dependencies import get_current_user
from backend.app.models import EmotionLog, Interaction, ProviderKey, User
from backend.app.services import providers
from backend.app.services.chat_service import _get_memories, forget_memories, get_preferences
from backend.app.services.crypto_service import decrypt, encrypt, mask
from backend.app.services.llm_service import check_key

router = APIRouter()


class ProviderKeyIn(BaseModel):
    provider: str
    api_key: Optional[str] = None  # omit to keep the stored key and only change the model
    model: Optional[str] = None
    activate: bool = True


class TestKeyIn(BaseModel):
    provider: str
    api_key: Optional[str] = None
    model: Optional[str] = None


@router.get("/settings/providers")
def list_providers(
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    rows = {row.provider: row for row in db.query(ProviderKey).all()}
    out = []
    for meta in providers.catalog():
        row = rows.get(meta["id"])
        configured = False
        masked = None
        if row is not None:
            plaintext = decrypt(row.api_key)
            configured = plaintext is not None
            masked = mask(plaintext) if plaintext else None
        out.append(
            {
                **meta,
                "configured": configured,
                "masked_key": masked,
                "model": (row.model if row else None) or meta["default_model"],
                "is_active": bool(row.is_active) if row else False,
            }
        )
    return {"providers": out}


@router.put("/settings/providers")
def save_provider(
    req: ProviderKeyIn,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    provider = providers.get(req.provider)
    if provider is None:
        raise HTTPException(status_code=400, detail=f"Unknown provider '{req.provider}'")

    row = db.query(ProviderKey).filter(ProviderKey.provider == req.provider).first()

    if req.api_key:
        key = req.api_key.strip()
        if row is None:
            row = ProviderKey(provider=req.provider, api_key=encrypt(key))
            db.add(row)
        else:
            row.api_key = encrypt(key)
    elif row is None:
        raise HTTPException(status_code=400, detail="An API key is required the first time")

    if req.model:
        row.model = req.model.strip()
    elif not row.model:
        row.model = provider.default_model

    if req.activate:
        db.query(ProviderKey).update({ProviderKey.is_active: 0})
        row.is_active = 1

    db.commit()
    db.refresh(row)

    plaintext = decrypt(row.api_key)
    return {
        "provider": row.provider,
        "model": row.model,
        "is_active": bool(row.is_active),
        "configured": plaintext is not None,
        "masked_key": mask(plaintext) if plaintext else None,
    }


@router.delete("/settings/providers/{provider_id}")
def delete_provider(
    provider_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    row = db.query(ProviderKey).filter(ProviderKey.provider == provider_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Provider not configured")
    db.delete(row)
    db.commit()
    return {"deleted": provider_id}


@router.post("/settings/providers/test")
def test_provider(
    req: TestKeyIn,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Probe a key with a 1-token request. Uses the stored key if none is supplied."""
    provider = providers.get(req.provider)
    if provider is None:
        raise HTTPException(status_code=400, detail=f"Unknown provider '{req.provider}'")

    api_key = req.api_key.strip() if req.api_key else None
    model = req.model or provider.default_model
    if not api_key:
        row = db.query(ProviderKey).filter(ProviderKey.provider == req.provider).first()
        if row is None:
            raise HTTPException(status_code=400, detail="No stored key for this provider")
        api_key = decrypt(row.api_key)
        model = req.model or row.model or provider.default_model
        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="Stored key can't be decrypted (SECRET_KEY changed). Re-enter it.",
            )

    ok, message = check_key(req.provider, api_key, model)
    return {"ok": ok, "message": message, "model": model}


# --- personality + permissions ------------------------------------------------


class PreferencesIn(BaseModel):
    allow_actions: Optional[bool] = None
    allow_code: Optional[bool] = None
    tone: Optional[Literal["warm", "professional", "playful", "calm"]] = None
    reply_length: Optional[Literal["brief", "normal", "detailed"]] = None
    language: Optional[Literal["auto", "en", "hi", "hinglish"]] = None


def _prefs_out(row) -> dict:
    return {
        "allow_actions": bool(row.allow_actions),
        "allow_code": bool(row.allow_code),
        "tone": row.tone,
        "reply_length": row.reply_length,
        "language": row.language,
    }


@router.get("/settings/preferences")
def read_preferences(
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    return _prefs_out(get_preferences(db, user.id))


@router.put("/settings/preferences")
def save_preferences(
    req: PreferencesIn,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Partial update: only the fields sent are changed."""
    row = get_preferences(db, user.id)
    for field, value in req.model_dump(exclude_none=True).items():
        setattr(row, field, int(value) if isinstance(value, bool) else value)
    db.add(row)
    db.commit()
    return _prefs_out(row)


# --- privacy + data -------------------------------------------------------------


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


@router.get("/settings/export")
def export_data(
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Everything stored about the user, as JSON.

    The face embedding is reported as enrolled/not rather than dumped: the raw
    vector is only useful to a face matcher, and a copy sitting in Downloads is a
    liability for the very person it identifies.
    """
    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "created_at": _iso(user.created_at),
            "face_enrolled": user.face_embedding is not None,
        },
        "preferences": _prefs_out(get_preferences(db, user.id)),
        "memories": _get_memories(user.id),
        "conversations": [
            {
                "at": _iso(i.created_at),
                "you": i.query_text,
                "emora": i.response_text,
                "emotion": i.emotion_label,
                "confidence": i.emotion_confidence,
            }
            for i in db.query(Interaction).filter(Interaction.user_id == user.id).order_by(Interaction.created_at)
        ],
        "emotion_log": [
            {"at": _iso(e.created_at), "source": e.source, "emotion": e.emotion, "confidence": e.confidence}
            for e in db.query(EmotionLog).filter(EmotionLog.user_id == user.id).order_by(EmotionLog.created_at)
        ],
        "reminders": [
            {
                "title": r.title,
                "description": r.description,
                "scheduled_at": _iso(r.scheduled_at),
                "repeat": r.repeat,
                "completed": bool(r.is_completed),
            }
            for r in user.reminders
        ],
    }


@router.delete("/settings/data/{kind}")
def clear_data(
    kind: Literal["chats", "mood", "memories"],
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    if kind == "memories":
        return {"deleted": forget_memories(user.id)}
    model = Interaction if kind == "chats" else EmotionLog
    deleted = db.query(model).filter(model.user_id == user.id).delete()
    db.commit()
    return {"deleted": deleted}


class DeleteAccountIn(BaseModel):
    confirm_name: str


@router.post("/settings/account/delete")
def delete_account(
    req: DeleteAccountIn,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Remove the user, their face enrollment, and everything linked to them.

    The typed name is checked here, not just in the UI, so a stray request can't
    wipe an account.
    """
    if req.confirm_name.strip().lower() != user.name.strip().lower():
        raise HTTPException(status_code=400, detail="Name doesn't match — account not deleted")
    forget_memories(user.id)
    db.delete(user)  # cascades: sessions, emotion logs, interactions, reminders, preferences
    db.commit()
    return {"deleted": True}
