import datetime
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship

from backend.app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    face_embedding = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")
    emotion_logs = relationship("EmotionLog", back_populates="user", cascade="all, delete-orphan")
    interactions = relationship("Interaction", back_populates="user", cascade="all, delete-orphan")
    reminders = relationship("Reminder", back_populates="user", cascade="all, delete-orphan")
    preference = relationship(
        "UserPreference", uselist=False, back_populates="user", cascade="all, delete-orphan"
    )


class UserPreference(Base):
    """Per-user choices the backend has to enforce or feed into the prompt.

    Purely cosmetic choices (voice, chat toggles, alerts) live in the browser.
    A missing row means every default below.
    """

    __tablename__ = "user_preferences"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    # Whitelisted OS actions: create file/folder, open app/URL.
    allow_actions = Column(Integer, default=1, nullable=False)
    # The run_python tool — arbitrary code on this machine, used for live lookups.
    allow_code = Column(Integer, default=1, nullable=False)
    tone = Column(String(20), default="warm", nullable=False)
    reply_length = Column(String(20), default="normal", nullable=False)
    language = Column(String(20), default="auto", nullable=False)

    user = relationship("User", back_populates="preference")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String(255), unique=True, index=True, nullable=False)
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="sessions")
    interactions = relationship("Interaction", back_populates="session", cascade="all, delete-orphan")


class EmotionLog(Base):
    __tablename__ = "emotion_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    source = Column(String(20), nullable=False)
    emotion = Column(String(50), nullable=False)
    confidence = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="emotion_logs")


class Interaction(Base):
    __tablename__ = "interactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=True)
    query_text = Column(Text, nullable=False)
    response_text = Column(Text, nullable=True)
    emotion_label = Column(String(50), nullable=True)
    emotion_confidence = Column(Float, nullable=True)
    emotion_vector = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="interactions")
    session = relationship("Session", back_populates="interactions")


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    scheduled_at = Column(DateTime, nullable=True)
    is_completed = Column(Integer, default=0)
    is_mood_triggered = Column(Integer, default=0)
    # Recurring cadence: None | "hourly" | "daily" | "weekly". Drives the
    # "water intake" style activity reminders named in the synopsis.
    repeat = Column(String(20), nullable=True)
    # When the user was actually told. Distinguishes "due" from "already fired",
    # so a reminder is delivered once rather than on every poll.
    notified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="reminders")


class ProviderKey(Base):
    """One row per configured LLM provider. `api_key` is Fernet-encrypted at rest."""

    __tablename__ = "provider_keys"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(40), unique=True, index=True, nullable=False)
    api_key = Column(Text, nullable=False)
    model = Column(String(120), nullable=True)
    is_active = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
