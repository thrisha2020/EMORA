"""Analytics / mood-history / profile endpoints (Bearer auth)."""

import datetime
from collections import Counter
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.dependencies import get_current_user
from backend.app.models import EmotionLog, Interaction, Reminder, Session as SessionModel, User
from backend.app.services.chat_service import get_preferences

router = APIRouter()


@router.get("/mood/history")
def mood_history(
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    days: int = 7,
):
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    logs = (
        db.query(EmotionLog)
        .filter(
            EmotionLog.user_id == user.id,
            EmotionLog.created_at >= since,
            EmotionLog.source == "fused",
        )
        .order_by(EmotionLog.created_at.asc())
        .all()
    )
    by_day: dict[str, list[str]] = {}
    for log in logs:
        day = log.created_at.date().isoformat()
        by_day.setdefault(day, []).append(log.emotion)

    # utcnow(), not date.today(): rows are filtered by UTC above, so labelling the
    # buckets with local dates shifted every point by a day near midnight.
    days_list = [
        (datetime.datetime.utcnow().date() - datetime.timedelta(days=i)).isoformat()
        for i in range(days - 1, -1, -1)
    ]
    emotions = []
    for day in days_list:
        labels = by_day.get(day, [])
        emotions.append(Counter(labels).most_common(1)[0][0] if labels else None)

    counts = Counter(log.emotion for log in logs)
    return {
        "days": days,
        # The real dates behind each point, so the chart can label them instead of
        # guessing weekday names by index.
        "dates": days_list,
        "emotions": emotions,
        "counts": dict(counts),
    }


@router.get("/analytics")
def analytics(
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    interactions = db.query(Interaction).filter(Interaction.user_id == user.id).count()
    reminders = db.query(Reminder).filter(Reminder.user_id == user.id).count()
    sessions = db.query(SessionModel).filter(SessionModel.user_id == user.id).count()
    logs = db.query(EmotionLog).filter(EmotionLog.user_id == user.id).all()
    counter = Counter(log.emotion for log in logs)
    common = counter.most_common(1)[0][0] if counter else "neutral"

    # `avg_emotion` used to repeat `common_emotion`, so two cards showed one number.
    # Report the last 24 hours instead, which is what "right now" should mean.
    since = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
    recent = Counter(log.emotion for log in logs if log.created_at and log.created_at >= since)
    return {
        "total_chats": interactions,
        "recent_emotion": recent.most_common(1)[0][0] if recent else None,
        "common_emotion": common,
        "total_reminders": reminders,
        "total_sessions": sessions,
        "emotion_counts": dict(counter),
    }


@router.get("/profile")
def profile(
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    counter = Counter(log.emotion for log in db.query(EmotionLog).filter(EmotionLog.user_id == user.id).all())
    return {
        "name": user.name,
        "joined": user.created_at.date().isoformat() if user.created_at else None,
        # The saved preference, not a hardcoded "en".
        "preferred_language": get_preferences(db, user.id).language,
        "emotion_stats": dict(counter),
    }
