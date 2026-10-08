"""Behavioural tracking: rolling mood trend and mood-triggered reminders."""

import datetime
from collections import Counter

from sqlalchemy.orm import Session

from backend.app.models import EmotionLog, Reminder

NEGATIVE = {"sad", "angry", "fear", "disgust"}

# A self-care nudge fires after this many consecutive negative fused readings,
# and at most once per cooldown window so it can't spam the reminder list.
_STREAK_THRESHOLD = 3
_COOLDOWN_HOURS = 12

_NUDGES = {
    "sad": ("Take a breather", "You've seemed low for a while. Step outside for five minutes?"),
    "angry": ("Cool-down break", "Things have felt tense. A short walk might help reset."),
    "fear": ("Grounding moment", "You've seemed anxious. Try a slow breath — in for four, out for six."),
    "disgust": ("Reset your space", "Something's been bothering you. A change of scene might help."),
}


def trend_summary(db: Session, user_id: int, days: int = 7) -> str | None:
    """One sentence describing the user's recent mood, for the system prompt."""
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    logs = (
        db.query(EmotionLog)
        .filter(
            EmotionLog.user_id == user_id,
            EmotionLog.source == "fused",
            EmotionLog.created_at >= since,
        )
        .all()
    )
    if len(logs) < 3:
        return None

    counts = Counter(log.emotion for log in logs)
    dominant, n = counts.most_common(1)[0]
    share = n / len(logs)
    if share < 0.4:
        return f"Mixed over the last {days} days, with no single dominant mood."
    qualifier = "consistently" if share > 0.7 else "often"
    return f"{qualifier} {dominant} over the last {days} days ({int(share * 100)}% of readings)."


def negative_streak(db: Session, user_id: int, window: int = 5) -> tuple[int, str | None]:
    """Length of the current run of negative readings, and which emotion leads it."""
    recent = (
        db.query(EmotionLog)
        .filter(EmotionLog.user_id == user_id, EmotionLog.source == "fused")
        .order_by(EmotionLog.created_at.desc())
        .limit(window)
        .all()
    )
    streak = 0
    seen: list[str] = []
    for log in recent:
        if log.emotion in NEGATIVE:
            streak += 1
            seen.append(log.emotion)
        else:
            break
    if not seen:
        return 0, None
    return streak, Counter(seen).most_common(1)[0][0]


def maybe_create_nudge(db: Session, user_id: int) -> Reminder | None:
    """Create a self-care reminder when a negative streak crosses the threshold."""
    streak, emotion = negative_streak(db, user_id)
    if streak < _STREAK_THRESHOLD or emotion not in _NUDGES:
        return None

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=_COOLDOWN_HOURS)
    recent_nudge = (
        db.query(Reminder)
        .filter(
            Reminder.user_id == user_id,
            Reminder.is_mood_triggered == 1,
            Reminder.created_at >= cutoff,
        )
        .first()
    )
    if recent_nudge is not None:
        return None

    title, description = _NUDGES[emotion]
    reminder = Reminder(
        user_id=user_id,
        title=title,
        description=description,
        is_mood_triggered=1,
    )
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder
