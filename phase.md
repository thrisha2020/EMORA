# Phase Plan — Emotion-Aware Intelligent Virtual Assistant

Team: Prajwal K H (4PM23CS076), Priya R G (4PM23CS080), Thrisha A P (4PM23CS115), Sachin M (4PM24CS408)
Guide: Ms. Vinutha H M, Dept. of CSE, PESITM
Start: Jul 29, 2026
Exhibition: Nov 9, 2026

---

## Phase 0 — Setup & Skeleton
Jul 29 – Jul 30 (2 days)

Goal: boilerplate code and infrastructure so 4 members can work in parallel.

- [x] FastAPI app scaffold — `backend/app/main.py`, router mounts, CORS, `.env` loader
- [x] SQLite + SQLAlchemy models: `users`, `sessions`, `emotion_logs`, `interactions`, `reminders`
- [x] Alembic (or plain `Base.metadata.create_all`) for DB creation
- [x] Streamlit scaffold — `frontend/app.py` with multi-page router placeholder
- [x] Docker Compose (optional — one-command `docker compose up` for dev)
- [x] `docs/task_split.md` — module ownership assigned across 4 members
- [x] `docs/progress_report.md` — written and ready for Aug 3 submission

Exit criteria: `uvicorn backend.app.main:app --reload` & `streamlit run frontend/app.py` both boot without error; DB tables created; team roles documented.

---

## Phase 1 — Auth + STT + Basic Chat
Jul 31 – Aug 9 (10 days)

Goal: end-to-end minimal pipeline — face login → speak → chatbot replies.

### 1A — Face Enrollment & Login (Prajwal K H)
- [x] Webcam capture utility (`backend/app/camera.py`)
- [x] DeepFace `register()` — capture frame, extract embedding, store in `users` table
- [x] DeepFace `login()` — capture frame, compare against enrolled embeddings
- [x] FastAPI endpoints: `POST /register`, `POST /login`
- [x] Token/session management (UUID-based in `sessions` table)

### 1B — Speech-to-Text (Thrisha A P)
- [x] Whisper integration — record from mic → transcribe
- [x] FastAPI endpoint: `POST /stt` (accepts audio bytes, returns text)
- [ ] Error handling: silence detection, noise fallback messages

### 1C — Basic Chatbot (Sachin M)
- [x] Gemini API integration (google-generativeai SDK)
- [x] FastAPI endpoint: `POST /chat` (text in → Gemini response → text out)
- [x] Simple conversation memory (last 10 exchanges per session from `interactions` table)

### 1D — Streamlit UI (Priya R G, coordinated by all)
- [x] Login page: webcam capture → `/login`
- [x] Registration page: webcam capture + name input → `/register`
- [x] Chat page: mic button → `/stt` → `/chat` → display response
- [x] Session management in `st.session_state`

Review 1 deliverable (Aug 10–14): Demo — face login → speak query → get chatbot reply. Slides explaining architecture, tech choices, team split.

---

## Phase 2 — Emotion Detection & Fusion
Aug 17 – Sep 15 (4 weeks)

Goal: assistant perceives user emotion from face + voice and adapts its tone.

### 2A — Facial Emotion Detection
- [ ] DeepFace emotion analysis on webcam frames (anger, fear, sad, happy, neutral, surprise, disgust)
- [ ] Frame-level smoothing (rolling majority over last N frames to avoid flicker)
- [ ] Return dominant emotion + confidence per utterance

### 2B — Voice Emotion Detection
- [ ] Audio feature extraction: MFCC, chroma, spectral (via Librosa)
- [ ] Train or load pretrained SER model (e.g. CREMA-D trained CNN or fine-tune wav2vec2)
- [ ] Return emotion label + confidence per voice clip
- [ ] Fallback: if SER model confidence is low, use text sentiment analysis (via Gemini or TextBlob) as proxy

### 2C — Emotion Fusion
- [ ] Weighted fusion of face + voice emotion labels
- [ ] Fusion logic: if both agree → high confidence; if conflict → lower confidence + pick face (more reliable)
- [ ] Normalized emotion vector appended to each interaction in DB

### 2D — Adaptive Chat Prompting
- [ ] Inject emotion label + recent mood trend into Gemini system prompt
- [ ] Tone adaptations: happy → playful, sad → gentle/supportive, angry → de-escalating
- [ ] Optional: emoji/sticker suggestions based on detected emotion

---

## Phase 3 — Personalization & Reminders
Sep 16 – Oct 5 (3 weeks)

Goal: assistant remembers user history, tracks mood trends, and acts on reminders.

- [ ] `interactions` table logging: query text, emotion label, confidence, Gemini response, timestamp
- [ ] Mood trend API: rolling 7-day / 30-day emotion histogram per user
- [ ] Reminder CRUD: `POST /reminders`, `GET /reminders`, `PATCH /reminders/:id/complete`
- [ ] Mood-triggered nudges: if sadness detected 3+ sessions in a row → suggest self-care reminder
- [ ] Dashboard page in Streamlit: mood chart, reminder list, interaction history
- [ ] Behavioral context injected into chatbot system prompt ("User has been feeling {mood} lately. Adjust accordingly.")

---

## Phase 4 — Testing, Tuning & Documentation
Oct 6 – Nov 9 (5 weeks)

### 4A — Integration & Accuracy (Oct 6–11)
- [ ] Face recognition accuracy under different lighting (confusion matrix)
- [ ] STT accuracy check (WER on test phrases)
- [ ] Emotion classification precision/recall/F1 per class
- [ ] Bug fixes across all modules

### 4B — Reports & Exhibition Prep (Oct 12–Nov 9)
- [ ] Draft report (methodology, results, screenshots, accuracy tables) — due Review 2 (Oct 12–16)
- [ ] Final report (incorporate Review 2 feedback)
- [ ] PowerPoint presentation
- [ ] Exhibition poster
- [ ] Demo rehearsal

### 4C — Stretch Goal: JARVIS-style Assistant + Local Automation Layer (if time permits after Oct 16)
- [ ] `POST /api/assistant` — LLM tool-calling (Groq) agent endpoint; decides when to execute OS action vs just reply; logs to `interactions`
- [ ] `backend/app/services/action_service.py` — whitelisted safe OS actions (subprocess): create/open folders (Desktop/Documents only), open apps, open URLs / web search, system info (time/battery/disk)
- [ ] `POST /api/tts` — edge-tts `en-US-AriaNeural` (rate +20%), returns audio bytes
- [ ] Streamlit **Assistant** page (dark HUD): mic → STT → `/api/assistant` → execute + speak reply + event/console log; Hinglish + English commands
- [ ] Voice-command app launcher (open apps via spoken command)
- [ ] Offline mode toggle: Whisper.cpp + Ollama local LLM
- [ ] Workflow automation ("open VS Code and pull latest")
- [ ] Demo showcase reel for exhibition

---

## Milestones Recap

| Date | Milestone | Phase |
|---|---|---|
| Jul 29–30 | Phase 0 done | Skeleton + DB |
| Aug 3 | Progress Report submitted | — |
| Aug 9 | Phase 1 done | Auth + STT + Chat |
| Aug 10–14 | Review 1 | Demo + Slides |
| Sep 15 | Phase 2 done | Emotion detection |
| Oct 5 | Phase 3 done | Personalization |
| Oct 11 | Phase 4A done | Testing |
| Oct 12–16 | Review 2 | Full pipeline + Draft report |
| Nov 6 | Phase 4B done | Final polish |
| Nov 9 | Exhibition | Final demo |

---

## Open Decisions (to close in Phase 0)

- [x] **Module ownership**: Prajwal (Face Auth), Thrisha (STT), Sachin (Chat), Priya (UI)
- [ ] **DB schema**: finalize columns + relationships in `docs/schema.md`
- [ ] **Frontend**: keep Streamlit or migrate to React for Phase 4 polish?
- [ ] **Deployment**: local-only or cloud-hosted for exhibition?
