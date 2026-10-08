"""Reminders endpoints (Bearer auth)."""

import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.dependencies import get_current_user
from backend.app.models import Reminder, User
from backend.app.services.reminder_service import (
    ACTIVITY_PRESETS,
    create_activity_reminder,
    due_reminders,
    mark_delivered,
)

router = APIRouter()


class ReminderCreate(BaseModel):
    title: str
    description: Optional[str] = None
    scheduled_at: Optional[datetime.datetime] = None
    repeat: Optional[str] = None  # hourly | daily | weekly


class ReminderOut(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    scheduled_at: Optional[datetime.datetime] = None
    is_completed: int
    is_mood_triggered: int
    repeat: Optional[str] = None
    notified_at: Optional[datetime.datetime] = None

    model_config = {"from_attributes": True}


class ReminderUpdate(BaseModel):
    is_completed: bool = True


@router.post("/reminders", response_model=ReminderOut)
def create_reminder(
    req: ReminderCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    reminder = Reminder(
        user_id=user.id,
        title=req.title.strip(),
        description=req.description,
        scheduled_at=req.scheduled_at,
        repeat=req.repeat if req.repeat in {"hourly", "daily", "weekly"} else None,
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder


@router.delete("/reminders/{reminder_id}")
def delete_reminder(
    reminder_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Remove a reminder. Scoped to the caller, so ids can't be probed."""
    reminder = (
        db.query(Reminder)
        .filter(Reminder.id == reminder_id, Reminder.user_id == user.id)
        .first()
    )
    if reminder is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    db.delete(reminder)
    db.commit()
    return {"deleted": reminder_id}


@router.get("/reminders", response_model=list[ReminderOut])
def list_reminders(
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    return (
        db.query(Reminder)
        .filter(Reminder.user_id == user.id)
        .order_by(Reminder.created_at.desc())
        .all()
    )


@router.patch("/reminders/{reminder_id}/complete", response_model=ReminderOut)
def complete_reminder(
    reminder_id: int,
    req: ReminderUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    reminder = (
        db.query(Reminder)
        .filter(Reminder.id == reminder_id, Reminder.user_id == user.id)
        .first()
    )
    if reminder is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    reminder.is_completed = 1 if req.is_completed else 0
    db.commit()
    db.refresh(reminder)
    return reminder


@router.get("/reminders/due", response_model=list[ReminderOut])
def get_due_reminders(
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Reminders to announce now. Polled by the client.

    Marks them delivered before returning, so each occurrence fires once, and
    advances recurring reminders to their next slot.
    """
    due = due_reminders(db, user.id)
    if due:
        # Snapshot before mark_delivered rewrites scheduled_at on repeats.
        payload = [ReminderOut.model_validate(r, from_attributes=True) for r in due]
        mark_delivered(db, due)
        return payload
    return []


@router.get("/reminders/presets")
def list_activity_presets(user: Annotated[User, Depends(get_current_user)]):
    """Built-in recurring activity reminders (water intake, breaks, posture)."""
    return {
        "presets": [
            {"id": k, "title": t, "description": d, "repeat": r}
            for k, (t, d, r) in ACTIVITY_PRESETS.items()
        ]
    }


@router.post("/reminders/presets/{preset_id}", response_model=ReminderOut)
def add_activity_preset(
    preset_id: str,
    user: Annotated[User, Depends(get_current_user)],
    first_in_minutes: int = 60,
    db: Session = Depends(get_db),
):
    reminder = create_activity_reminder(db, user.id, preset_id, first_in_minutes)
    if reminder is None:
        raise HTTPException(status_code=400, detail=f"Unknown preset '{preset_id}'")
    return reminder
