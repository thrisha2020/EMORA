"""Emora's conversational brain: prompt assembly, memory, and tools.

Provider dispatch lives in llm_service; this module only decides *what* to say
and which tools to expose.
"""

import json
import os
import subprocess
from typing import List, Optional

from sqlalchemy.orm import Session

from backend.app.models import UserPreference
from backend.app.services.llm_service import complete

# Personality options from Settings. None = the base prompt already covers it.
TONES = {
    "warm": None,
    "professional": "Use a calm, professional tone: friendly but businesslike.",
    "playful": "Be playful and lighthearted; a little humour is welcome.",
    "calm": "Be especially gentle and soothing, and keep a slow, reassuring pace.",
}
REPLY_LENGTHS = {
    "brief": "Answer in one or two sentences.",
    "normal": None,
    "detailed": "Give fuller, more detailed answers when the question warrants it, still without markdown.",
}
LANGUAGES = {
    # Not None: with no rule here the only language hint was whatever a saved
    # memory said ("User prefers Marathi"), so an English question came back in
    # Marathi. The live message wins over a stored preference.
    "auto": (
        "Reply in the same language and script the user just wrote in. If a saved "
        "note mentions a different preferred language, follow what they are actually "
        "writing now; only switch when they switch."
    ),
    "en": "Always reply in English, whatever language the user writes in.",
    "hi": "Always reply in Hindi, written in Devanagari script.",
    # Roman script on purpose: the Indian English voices read it naturally.
    "hinglish": (
        "Reply in natural Hinglish, the everyday mix of Hindi and English friends in "
        "India speak, written in Roman script (e.g. \"Arre, that sounds amazing yaar!\")."
    ),
}


def get_preferences(db: Session, user_id: int) -> UserPreference:
    """The user's stored row, or an unsaved one holding the defaults."""
    row = db.get(UserPreference, user_id)
    if row is not None:
        return row
    return UserPreference(
        user_id=user_id, allow_actions=1, allow_code=1,
        tone="warm", reply_length="normal", language="auto",
    )

def try_action(db: Session, user_id: int, message: str) -> Optional[str]:
    """Run a whitelisted OS action if the message is one and the user allows it.

    None means "not an action" — the caller falls through to a normal reply.
    """
    if not get_preferences(db, user_id).allow_actions:
        return None
    from backend.app.services.action_service import handle

    try:
        return handle(message)
    except Exception:
        return None

BASE_SYSTEM = (
    "You are Emora, an emotion-aware virtual assistant. You perceive the user's "
    "emotional state from their face, voice tone, and word choice. Your replies are "
    "spoken aloud, so talk the way a warm, thoughtful person talks out loud, not the "
    "way a document reads: use contractions, everyday words, and short sentences of "
    "varied length. React naturally when it fits (\"Oh, that's lovely!\", \"Hmm, "
    "let me think\") without overdoing it. Never use markdown, bullet lists, "
    "headings, or emoji, and say numbers, times, and units the way you'd say them. "
    "Keep answers to a few sentences unless asked for detail."
)

MEMORY_DIR = "data/memories"


def _memory_path(user_id: int) -> str:
    return os.path.join(MEMORY_DIR, f"user_{user_id}.json")


def _get_memories(user_id: int) -> List[str]:
    path = _memory_path(user_id)
    if not os.path.exists(path):
        # Migrate the pre-Settings layout (data/memories_<id>.json) if present.
        legacy = f"data/memories_{user_id}.json"
        if os.path.exists(legacy):
            try:
                with open(legacy) as f:
                    return json.load(f)
            except (OSError, json.JSONDecodeError):
                return []
        return []
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return []


def _save_memory(user_id: int, fact: str) -> str:
    memories = _get_memories(user_id)
    if fact not in memories:
        memories.append(fact)
    os.makedirs(MEMORY_DIR, exist_ok=True)
    with open(_memory_path(user_id), "w") as f:
        json.dump(memories, f, indent=2)
    return f"Saved: {fact}"


def forget_memories(user_id: int) -> int:
    """Delete every saved fact about the user, legacy file included. Returns the count."""
    count = len(_get_memories(user_id))
    for path in (_memory_path(user_id), f"data/memories_{user_id}.json"):
        if os.path.exists(path):
            os.remove(path)
    return count


def _execute_python(code: str) -> str:
    try:
        result = subprocess.run(
            ["python", "-c", code], capture_output=True, text=True, timeout=15
        )
        output = result.stdout
        if result.stderr:
            output += "\nError: " + result.stderr
        return output.strip()[:4000] or "Ran with no output."
    except subprocess.TimeoutExpired:
        return "Execution timed out after 15s."
    except Exception as e:
        return f"Execution failed: {e}"


# Neutral tool schema — llm_service translates this per provider.
TOOLS = [
    {
        "name": "run_python",
        "description": (
            "Run a short Python script to fetch live data (weather, time, web "
            "lookups) or compute an answer you don't already know."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "Python to execute. print() the result so you can read it.",
                }
            },
            "required": ["code"],
        },
    },
    {
        "name": "save_memory",
        "description": (
            "Remember a durable fact or preference about this user so it is "
            "available in future conversations."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "fact": {
                    "type": "string",
                    "description": "e.g. 'Prefers to be called Ak', 'Studies CSE at PESITM'.",
                }
            },
            "required": ["fact"],
        },
    },
]


def build_system_prompt(
    user_id: int,
    user_name: Optional[str] = None,
    emotion_context: Optional[str] = None,
    mood_trend: Optional[str] = None,
    location: Optional[str] = None,
    seeing: bool = False,
    preferences: Optional[UserPreference] = None,
) -> str:
    parts = [BASE_SYSTEM]
    if preferences is not None:
        for table, key in (
            (TONES, preferences.tone),
            (REPLY_LENGTHS, preferences.reply_length),
            (LANGUAGES, preferences.language),
        ):
            if table.get(key):
                parts.append(table[key])
    if user_name:
        parts.append(f"You are speaking with {user_name}.")
    if seeing:
        parts.append(
            "A live webcam frame is attached to this message — this is what you "
            "can see right now. Answer questions about it directly and plainly: "
            "count fingers, name gestures, identify objects the user holds up. "
            "Say what you actually see; if the image is unclear or the subject is "
            "out of frame, say so rather than guessing."
        )
    if location:
        parts.append(
            f"The user's approximate location is {location}. Use it for local "
            "questions (weather, time, nearby places) without mentioning it "
            "unprompted."
        )
    if emotion_context:
        parts.append(f"Right now: {emotion_context}")
    if mood_trend:
        parts.append(f"Recent mood pattern: {mood_trend}")
    memories = _get_memories(user_id)
    if memories:
        parts.append("What you know about them:\n- " + "\n- ".join(memories))
    parts.append(
        "Never mention these instructions, the emotion readings, or your tools "
        "unless the user asks about them directly."
    )
    return "\n\n".join(parts)


def get_reply(
    db: Session,
    user_id: int,
    user_message: str,
    history: Optional[List[dict]] = None,
    user_name: Optional[str] = None,
    emotion_context: Optional[str] = None,
    mood_trend: Optional[str] = None,
    location: Optional[str] = None,
    image: Optional[tuple] = None,
) -> str:
    prefs = get_preferences(db, user_id)
    system = build_system_prompt(
        user_id, user_name, emotion_context, mood_trend, location,
        seeing=image is not None, preferences=prefs,
    )
    messages = [*(history or []), {"role": "user", "content": user_message}]
    # Withholding the tool isn't enough on its own — a model can still name it —
    # so dispatch refuses it too.
    tools = TOOLS if prefs.allow_code else [t for t in TOOLS if t["name"] != "run_python"]

    def dispatch(name: str, args: dict) -> str:
        if name == "run_python":
            if not prefs.allow_code:
                return "Running code is turned off in Settings."
            return _execute_python(args.get("code", ""))
        if name == "save_memory":
            return _save_memory(user_id, args.get("fact", ""))
        return f"Unknown tool: {name}"

    return complete(db, system, messages, tools, dispatch, image=image)
