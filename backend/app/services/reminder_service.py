"""Reminder delivery — the part that actually fires.

`scheduled_at` was previously written and never read, so a reminder set for 5pm
simply never arrived. This module answers "what is due right now?", marks what
has been delivered so it fires once, and rolls recurring reminders forward.

Delivery is pull-based: the client polls `/api/reminders/due`. That avoids a
background scheduler thread and, more importantly, means a reminder is only
announced while the user is actually present to hear it.
"""

import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from backend.app.models import Reminder

# How far past its time a reminder may still be announced. Beyond this the
# moment has passed and firing it is noise rather than help.
STALE_AFTER = datetime.timedelta(hours=2)

REPEAT_INTERVALS = {
    "hourly": datetime.timedelta(hours=1),
    "daily": datetime.timedelta(days=1),
    "weekly": datetime.timedelta(weeks=1),
}

# Activity reminders offered out of the box. "Water intake" is named directly in
# the synopsis as the example of daily-pattern tracking.
ACTIVITY_PRESETS = {
    "water": ("Drink some water", "A glass now keeps you sharp.", "hourly"),
    "posture": ("Check your posture", "Sit back, shoulders down.", "hourly"),
    "break": ("Take a short break", "Look away from the screen for a minute.", "hourly"),
    "sleep": ("Wind down for bed", "Screens off soon — you'll sleep better.", "daily"),
}


def due_reminders(db: Session, user_id: int, now: Optional[datetime.datetime] = None) -> List[Reminder]:
    """Reminders that should be announced to this user right now."""
    now = now or datetime.datetime.utcnow()
    candidates = (
        db.query(Reminder)
        .filter(
            Reminder.user_id == user_id,
            Reminder.is_completed == 0,
            Reminder.scheduled_at.isnot(None),
            Reminder.scheduled_at <= now,
        )
        .order_by(Reminder.scheduled_at.asc())
        .all()
    )

    due = []
    for r in candidates:
        # Already announced this occurrence?
        if r.notified_at is not None and r.notified_at >= r.scheduled_at:
            continue
        if now - r.scheduled_at > STALE_AFTER:
            # Missed entirely. Roll a recurring one forward; retire a one-off.
            if r.repeat in REPEAT_INTERVALS:
                r.scheduled_at = _next_occurrence(r.scheduled_at, r.repeat, now)
            else:
                r.notified_at = now
            continue
        due.append(r)

    db.commit()
    return due


def mark_delivered(
    db: Session, reminders: List[Reminder], now: Optional[datetime.datetime] = None
) -> None:
    """Record delivery, and schedule the next occurrence of recurring reminders."""
    now = now or datetime.datetime.utcnow()
    for r in reminders:
        r.notified_at = now
        if r.repeat in REPEAT_INTERVALS:
            r.scheduled_at = _next_occurrence(r.scheduled_at, r.repeat, now)
    db.commit()


def _next_occurrence(
    scheduled_at: datetime.datetime, repeat: str, now: datetime.datetime
) -> datetime.datetime:
    """Advance past `now` in whole intervals, keeping the original time of day."""
    step = REPEAT_INTERVALS[repeat]
    nxt = scheduled_at + step
    while nxt <= now:
        nxt += step
    return nxt


def create_activity_reminder(
    db: Session, user_id: int, preset: str, first_in_minutes: int = 60
) -> Optional[Reminder]:
    """Create one of the built-in recurring activity reminders."""
    if preset not in ACTIVITY_PRESETS:
        return None
    title, description, repeat = ACTIVITY_PRESETS[preset]
    reminder = Reminder(
        user_id=user_id,
        title=title,
        description=description,
        repeat=repeat,
        scheduled_at=datetime.datetime.utcnow() + datetime.timedelta(minutes=first_in_minutes),
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder
