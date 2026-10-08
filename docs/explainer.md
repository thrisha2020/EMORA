# Project Explainer — Emotion-Aware Intelligent Virtual Assistant

_A teaching guide for the presenting students. Use this to understand, present, and answer questions._

---

## 1. Big Picture (what this project is)

This is an **emotion-aware virtual assistant**. Most assistants just answer questions. This one:

1. **Knows who you are** — logs you in by your face (not passwords).
2. **Hears your mood** — detects emotion from your face, voice, and words.
3. **Changes how it talks** — replies with a tone that matches your emotion.
4. **Remembers you** — stores chat history, emotions, and (in Phase 3) reminders + mood trends.

**Elevator pitch (30 seconds):**
> "We built an AI assistant that recognizes users by face, reads their emotion from face + voice + text, fuses those signals into one emotion, and adapts its replies using a large language model. Everything is logged so the assistant gets more personal over time."

---

## 2. Architecture (the data flow)

```
Camera / Mic (Streamlit UI — frontend)
        │  REST (POST)
        ▼
FastAPI backend (:8000)
        │
        ├── Face Login/Register  →  DeepFace (embedding match)
        ├── Speech-to-Text       →  Whisper
        ├── Face Emotion         →  DeepFace emotion model
        ├── Voice Emotion        →  librosa MFCC → classifier
        ├── Text Sentiment       →  keyword lexicon
        ├── Emotion Fusion       →  weighted combine → 1 emotion
        ├── Chat                 →  Groq LLM (llama-3.3-70b)
        └── SQLite               →  users, sessions, interactions, emotion_logs, reminders
```

**One-line summary of the stack:**
> "Streamlit builds the UI. FastAPI serves the REST API. DeepFace handles faces. Whisper handles speech. librosa + a classifier handle voice emotion. An OpenAI-compatible LLM (Groq) is the conversational brain. SQLite is the memory."

---

## 3. Module-by-module breakdown

For each module, know: **file → endpoint → one-liner → what model/library it uses.**

### 3.1 User Registration / Login
- **Files:** `backend/app/services/face_service.py`, `backend/app/routers/auth.py`
- **Endpoints:** `POST /api/register`, `POST /api/login`
- **How it works:** The webcam image is converted by DeepFace (Facenet model) into a **face embedding** — a list of numbers that uniquely describe the face. On login, the new embedding is compared to stored ones; if the distance is below a threshold (0.8), it's the same person.
- **One-liner:** *"Face → number vector → match by distance."*

### 3.2 Speech-to-Text
- **Files:** `backend/app/services/stt_service.py`, `backend/app/routers/stt.py`
- **Endpoint:** `POST /api/stt`
- **How it works:** Audio bytes from the mic → **Whisper** (OpenAI's speech-to-text, the "tiny" model) → transcribed text returned.
- **One-liner:** *"Audio → Whisper → text."*

### 3.3 Facial Emotion Detection
- **Files:** `backend/app/services/emotion_service.py`, `backend/app/routers/emotion.py`
- **Endpoint:** `POST /api/emotion/face`
- **Emotions:** happy, sad, angry, neutral, surprise, fear, disgust
- **How it works:** DeepFace emotion model analyzes the face, returns a score per emotion. A rolling history smooths flicker between frames.
- **One-liner:** *"DeepFace reads the mood from the face."*

### 3.4 Voice Emotion Detection
- **Files:** `backend/app/services/emotion_service.py`, `backend/app/routers/emotion.py`
- **Endpoint:** `POST /api/emotion/voice`
- **Emotions:** happy, sad, angry, neutral
- **How it works:** **librosa** extracts MFCC features (tone/pitch) from the audio → a classifier predicts the emotion. If confidence is low, it falls back to text sentiment.
- **⚠️ Honest caveat:** the voice classifier is currently a **placeholder** (untrained), so in practice voice mostly reports neutral and text sentiment carries the fallback. This is a known Phase 2/3 improvement.

### 3.5 Emotion Fusion
- **Files:** `backend/app/services/emotion_service.py` → `fuse_emotions()`
- **Endpoint:** `POST /api/emotion/analyze`
- **How it works:** Face, voice, and text emotions are combined with **weights**:
  - Strong non-neutral face → high influence
  - Text carries more weight when the face is neutral
  - Voice is always lightly weighted
- **One-liner:** *"Three signals → one final emotion with a confidence score."*

### 3.6 Adaptive Chatbot
- **Files:** `backend/app/routers/chat.py`, `backend/app/services/chat_service.py`
- **Endpoint:** `POST /api/chat`
- **How it works:** The detected emotion maps to a **tone instruction** (e.g. sad → "respond with empathy and warmth"). That instruction is injected into the LLM's **system prompt**, then the user message is sent to Groq's llama-3.3-70b.
- **Key insight:** the emotion is NOT added to the user's message. It shapes the system prompt. The LLM decides *how* to say it; we decide *what mood* it's in.
- **One-liner:** *"Emotion → system prompt → LLM replies in the right tone."*

### 3.7 Conversation History
- **Files:** `backend/app/models.py` (`Interaction`), `chat.py`
- **How it works:** Every exchange (user message, assistant reply, emotion, timestamp, session) is saved to the `interactions` table. The last 10 are loaded back into the LLM context so the assistant "remembers".
- **One-liner:** *"SQLite remembers the last 10 exchanges per user."*

### 3.8 Session Management
- **Files:** `backend/app/services/session_service.py`
- **How it works:** Login creates a UUID session token stored in the `sessions` table. The token accompanies chat/emotion calls. Logout invalidates the session.

### 3.9 Database
- **Files:** `backend/app/models.py`, `backend/app/init_db.py`
- **Tables:** `users`, `sessions`, `interactions`, `emotion_logs`, `reminders` (all created automatically on setup).
- **One-liner:** *"One SQLite file stores everything — users, sessions, chats, emotions, reminders."*

### 3.10 Camera & Audio Support
- **Files:** `frontend/utils.py`
- **Camera:** built-in laptop webcam **or** IP Webcam (Android) via `{url}/shot.jpg`. Sidebar radio switches source.
- **Microphone:** Streamlit's `audio_input` widget → recorded WAV → Whisper.
- **One-liner:** *"Both laptop and phone camera/mic are supported."*

---

## 4. Frontend Pages (Streamlit)

| Page | What it does | Code file |
|---|---|---|
| Login | Capture face → `POST /login` | `frontend/pages/login.py` |
| Register | Capture face + name → `POST /register` | `frontend/pages/register.py` |
| Chat | Type/mic → emotion → `POST /chat` → show reply | `frontend/pages/chat.py` |
| (Phase 3) Dashboard | mood graphs, reminders, history | _not built yet_ |
| (4C stretch) Assistant | JARVIS-style voice + OS actions + TTS | _not built yet_ |

`frontend/app.py` is the page router; `st.session_state` keeps token, user, camera captures.

---

## 5. Demo Script (live run order)

Run this exact order — it tells the story best.

1. **Register** — "I'll enroll my face with my name. DeepFace converts my face into an embedding — a numeric fingerprint of my face — and stores it."
2. **Logout → Login** — compare embeddings → "distance below 0.8 → matched. A session token is created."
3. **Speak** — use mic and say: *"Hi, can you tell me the capital of France?"* → Whisper transcribes it.
4. **Emotion** — capture a face frame → shows the detected emotion + confidence (e.g. "happy 0.83").
5. **Reply** — the chat sends the message + emotion; Groq replies with a tone that matches (happy → playful, sad → gentle).

**Fallbacks if things fail live**
- If face match fails: "let me try again with better lighting" and retry, or switch to the IP Webcam.
- If STT fails: "let's continue with typed input" — pipeline still shows.
- If emotion is neutral: "the face reads neutral, but the words carry a happy sentiment" (fusion still shows).

---

## 6. Likely Presentation Q&A

**Q: Why DeepFace?**
> Free, pretrained, works out of the box for both face verification and emotion — best for a semester project without training deep models from scratch.

**Q: Why Whisper?**
> OpenAI's speech-to-text. Small ("tiny") model keeps latency low; it's good enough for short commands.

**Q: Why Groq instead of OpenAI?**
> Groq serves the same OpenAI-compatible API (llama-3.3-70b) with fast inference and a free tier. Switching providers is just a `.env` change.

**Q: Why SQLite?**
> Zero-config, file-based, perfect for a college demo. Can move to PostgreSQL later.

**Q: Why Streamlit?**
> Quickest way to build a web UI with camera, mic, chat, and charts — all Python.

**Q: How accurate is face login?**
> We store normalized embeddings and threshold the distance. Accuracy depends on lighting — demoed with good lighting.

**Q: Is the emotion detection "AI trained by us"?**
> No — we use pretrained DeepFace for faces. The voice classifier is our own but needs training; this is a planned improvement.

---

## 7. Current Project Status

| Area | Status |
|---|---|
| Phase 1 — Face auth + STT + basic chat | ✅ done |
| Phase 2 — Face/voice emotion + fusion + adaptive chat | ✅ done (voice model = placeholder) |
| Phase 3 — Reminders, mood dashboard, behavioral tracking | ⬜ next (not started) |
| 4C stretch — JARVIS assistant (voice + TTS + OS control) | ⬜ planned |

**MVP feature checklist (from synopsis):**
1. ✅ Face Registration
2. ✅ Face Login
3. ✅ Speech-to-Text
4. ✅ Facial Emotion Detection
5. 🟡 Voice — detection (placeholder model)
6. ✅ Emotion Fusion
7. ✅ Adaptive Chatbot (LLM)
8. ✅ Conversation History
9. ⬜ Reminder System (Phase 3)
10. ⬜ Mood Tracking Dashboard (Phase 3)

---

## 8. Setup & Running (cheat sheet)

```bash
# macOS / Linux — one-time
bash setup.sh

# Windows
setup.bat   # or: powershell -ExecutionPolicy Bypass -File setup.ps1

# then, two terminals
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
streamlit run frontend/app.py --server.port 8502
# open http://localhost:8502
```

Notes:
- `.env` must contain `LLM_API_KEY` (Groq key). `setup.sh`/`setup.bat` create `.env` from `.env.example`.
- First STT run downloads the Whisper "tiny" model (~100 MB).
- `--host 0.0.0.0` lets the phone camera (IP Webcam) reach the API on the LAN.