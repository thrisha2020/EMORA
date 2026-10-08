import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./data/emotion_assistant.db")
SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")

from typing import Optional

LLM_API_KEY: str = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or ""
LLM_MODEL: str = os.getenv("LLM_MODEL", "gpt-4o-mini")
LLM_BASE_URL: Optional[str] = os.getenv("LLM_BASE_URL") or None

# Preload the STT + emotion models at startup. On by default: cold-loading them
# inside the first voice turn blocks for ~2 minutes, which reads as the assistant
# ignoring you. Set EMORA_WARMUP=0 on a memory-constrained machine to load them
# lazily instead — the first turn is slow, but ~2-3 GB stays unpinned.
WARMUP_MODELS: bool = os.getenv("EMORA_WARMUP", "1").strip().lower() not in {"0", "false", "no"}

# Anti-spoofing on face login: rejects a photo or a screen held up to the camera.
# On by default; EMORA_FACE_LIVENESS=0 turns it off (the extra model downloads on
# first use, and a very dark webcam can trip it).
FACE_LIVENESS: bool = os.getenv("EMORA_FACE_LIVENESS", "1").strip().lower() not in {"0", "false", "no"}
