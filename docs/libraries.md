# Libraries & Tech Used — Emotion-Aware Intelligent Virtual Assistant

_Feature-wise map of every library and technology used, with why we chose it._

**Companion doc:** `docs/explainer.md` (how the project works end to end).

---

## 1. Tech Stack Overview

| Layer | Tool | Role | Why chosen |
|---|---|---|---|
| Backend API | **FastAPI** + **Uvicorn** | REST endpoints, ASGI server | Modern, auto-generated docs, minimal boilerplate |
| Frontend | **Streamlit** | Login / Register / Chat UI, camera & mic widgets | Fastest Python web UI — no HTML/CSS/JS needed |
| HTTP client | **Requests** | Frontend → backend API calls | Simple, standard, reliable |
| Database | **SQLite** + **SQLAlchemy ORM** | Stores users, sessions, interactions, emotion_logs, reminders | Zero-config, file-based, perfect for a demo |
| Config | **python-dotenv** | Loads `.env` secrets | Keeps API keys out of source code |
| Face AI | **DeepFace** (Facenet model) + **OpenCV** | Face embeddings + emotion analysis + webcam frames | Pretrained, works out of the box |
| Speech AI | **OpenAI Whisper** (tiny) | Speech-to-text | Accurate STT with a small, fast model |
| Voice AI | **librosa** + **scikit-learn** | MFCC features, emotion classifier | Standard audio feature extraction + ML |
| Text AI | Custom sentiment lexicon | Word-level sentiment (happy/sad/etc.) | No external dependency, fully controllable |
| LLM | **OpenAI SDK + Groq llama-3.3-70b** | Conversational replies with emotion-tuned tone | Fast inference, free tier, OpenAI-compatible |

---

## 2. Feature-wise Library Matrix

| Feature | Library / Model | Purpose | Code location |
|---|---|---|---|
| Face Registration | DeepFace (Facenet) | Convert face → embedding | `backend/app/services/face_service.py`, `POST /api/register` |
| Face Login | DeepFace (Facenet) | Compare embeddings, threshold 0.8 | `face_service.py`, `POST /api/login` |
| Webcam capture | OpenCV (`cv2`) | Encode/decode video frames | `backend/app/camera.py`, `frontend/utils.py` |
| IP Webcam (phone) | `requests` → `/shot.jpg` | Fetch frame from Android IP Webcam | `frontend/utils.py` |
| Speech-to-Text | OpenAI Whisper (tiny) | Audio → text transcription | `backend/app/services/stt_service.py`, `POST /api/stt` |
| Facial Emotion | DeepFace emotion model + OpenCV | 7 emotions: happy, sad, angry, neutral, surprise, fear, disgust | `backend/app/services/emotion_service.py`, `POST /api/emotion/face` |
| Voice Emotion | librosa (MFCC + spectral) + scikit-learn MLP | Tone/pitch → happy, sad, angry, neutral | `emotion_service.py`, `POST /api/emotion/voice` |
| Text Sentiment | Custom keyword lexicon | Word-level sentiment (40+ words/emotion) | `emotion_service.py` |
| Emotion Fusion | Custom weighting logic | Combine face + voice + text → single emotion | `emotion_service.py` → `fuse_emotions()` |
| Emotion smoothing | NumPy rolling history | Reduce flicker between frames | `emotion_service.py` → `smooth_emotion()` |
| Conversation History | SQLAlchemy + SQLite | Store + reload last 10 exchanges | `backend/app/models.py` (`Interaction`), `backend/app/routers/chat.py` |
| LLM Chat | OpenAI SDK + **Groq** llama-3.3-70b | Reply with emotion-tuned system prompt | `backend/app/services/chat_service.py`, `POST /api/chat` |
| Session tokens | `uuid` + SQLAlchemy | Create/login session tokens | `backend/app/services/session_service.py` |
| Audio handling | `soundfile` + `tempfile` | Read/write WAV for Whisper | `stt_service.py` |

---

## 3. Critical Version Pins & Why

| Package | Pin | Reason |
|---|---|---|
| Python | 3.10 – 3.12 | Scan by setup scripts; newer libs pegged |
| `opencv-python` | `>=4.9,<5.0` | 5.x removes haarcascade data that DeepFace uses |
| `tensorflow` | `==2.21.0` | Backend for DeepFace Facenet; pinned for reliable install |
| `openai-whisper` | `>=20231117` | `tiny` model downloaded on first STT call (~100 MB) |
| `deepface` | `>=0.0.79` | Works with current TF + opencv pins |

---

## 4. Planned / Not Yet Shipped (roadmap)

| Future feature | Library | Phase |
|---|---|---|
| JARVIS voice assistant (TTS) | `edge-tts` (`en-US-AriaNeural`) | 4C stretch |
| Real voice-emotion model | Trained SER (e.g. CREMA-D) | 2/3 improvement |
| Mood dashboard charts | Streamlit built-in `st.line_chart` / Plotly | Phase 3 |
| Reminders | SQLAlchemy (schema already exists) | Phase 3 |
| PostgreSQL | `psycopg2` | only if scale needed |

---

## 5. `.env` Config Reference

| Key | Example | Purpose |
|---|---|---|
| `LLM_API_KEY` | `gsk_...` (Groq) | API key for the LLM |
| `LLM_MODEL` | `llama-3.3-70b-versatile` | LLM model name |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-compatible base URL |
| `DATABASE_URL` | `sqlite:///./data/emotion_assistant.db` | DB path |
| `SECRET_KEY` | `change-me-to-a-random-string` | (reserved for signing) |

**Provider-agnostic:** the LLM client speaks the OpenAI API, so switching between Groq / Gemini / OpenAI / DeepSeek is only an `.env` edit.