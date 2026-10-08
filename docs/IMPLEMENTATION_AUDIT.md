# Emora: Implementation Audit

> **Scope:** the whole repository, read on 2026-09-17. `node_modules/`, `venv/` and personal data under `data/` were excluded.
> **Method:** a feature counts as implemented only if executable code proves it. File and line references were checked against the source. Items marked **(traced)** are bugs found by reading the control flow; they were not reproduced at runtime.

---

## 0. Change log — fixes applied 17 Sep 2026

The eight priority items from `docs/FINAL_AUDIT_AND_COMPLIANCE.md` are now fixed in code, each with a test (backend suite: 121 passing).

| # | Fix | Files | Test |
|---|---|---|---|
| 1 | Reminders UI now sends `scheduled_at` (native date-time picker + repeat) and reads `is_completed`; complete sends the required body | `services/reminders.ts`, `pages/Reminders/RemindersPage.tsx` | `TestRemindersContract` |
| 2 | Face-login capture keyed to a scan counter, so a failed scan reaches the retry state and stops the camera | `pages/Login/LoginPage.tsx` | traced fix (no runtime test) |
| 3 | One `<video>` stays mounted; preview only hides it, so capture keeps working | `pages/Chat/ChatPage.tsx` | traced fix (no runtime test) |
| 4 | Per-request STT temp files, cleanup, 30 s ffmpeg timeout, clear error when ffmpeg is missing | `services/stt_service.py` | `TestSttTempFiles` |
| 5 | Face liveness via DeepFace `anti_spoofing`, `EMORA_FACE_LIVENESS` (default on), fails open if the model is unavailable, 401 on spoof | `services/face_service.py`, `config.py`, `routers/auth.py` | `TestFaceLiveness` |
| 6 | `open_url` uses `webbrowser.open` instead of a mangled `Path` | `services/action_service.py` | `TestDesktopActionSafety` |
| 7 | `create_file` never overwrites (`touch(exist_ok=False)`) | `services/action_service.py` | `TestDesktopActionSafety` |
| 8 | Tokens carry `sid`; revoked sessions are rejected; `POST /api/logout`; frontend calls it on sign-out | `jwt_service.py`, `dependencies.py`, `routers/auth.py`, `contexts/AuthContext.tsx` | `TestLogout` |

Sections 4–13 below describe the state **before** these fixes, except where a row says otherwise.

---

## 1. Executive Summary

| Item | Value |
|---|---|
| Project | **Emora**: an emotion-aware virtual assistant with face login, 3D avatar, voice, chat and reminders |
| Frontend | `emora-frontend/src`: **63 files** (TS/TSX/CSS), about **6,234 lines** of TypeScript |
| Backend | `backend/`: **32 Python files** (3 are empty `__init__.py`), about **3,451 lines** |
| Tests | 104 backend tests (`tests/test_api.py` 88, `tests/test_emotion_service.py` 16); 3 Puppeteer e2e scripts |
| Languages | TypeScript, Python 3.12, CSS, JavaScript (e2e `.mjs`), Shell / PowerShell / Batch |
| Frameworks | React 19 + Vite 8, react-three-fiber (three.js), FastAPI + SQLAlchemy 2 (SQLite) |
| AI models | DeepFace Facenet (face ID), DeepFace emotion, wav2vec2 SER (2 checkpoints), DistilRoBERTa emotion, NVIDIA Parakeet-TDT 0.6B v3, Whisper tiny, cloud LLMs (OpenAI / Anthropic / Groq / xAI / NVIDIA), Microsoft Edge neural TTS |
| Background jobs | None server-side apart from 2 warmup threads. Reminders are delivered when the client polls. |
| **Completion estimate** | **About 72%** by the feature matrix in §13 (42 ✅, 17 🟡, 11 ❌ of 70 rows, with 🟡 counted as half). The core loop works end to end: face login → emotion reading → chat → voice reply with avatar. Reminders UI, logout/sessions and several docs-promised features lag behind. |

---

## 2. Folder Structure

```
emotion-assistant/
├── backend/app/                 FastAPI application
│   ├── main.py                  app, routers, lifespan (create tables, warmup threads), /api/health, SPA serving
│   ├── config.py                env vars (DATABASE_URL, SECRET_KEY, LLM_*, EMORA_WARMUP)
│   ├── database.py / models.py  SQLAlchemy engine and 7 ORM tables
│   ├── dependencies.py          get_current_user (JWT check)
│   ├── camera.py                bytes → OpenCV frame (other helpers unused)
│   ├── init_db.py               table creation (redundant with lifespan)
│   ├── routers/                 HTTP endpoints: auth, chat, emotion, stt, assistant(tts), reminders, analytics, settings
│   └── services/                business logic: face, emotion, stt, tts, llm, chat, providers, crypto,
│                                jwt, session, mood, reminder, action (desktop), face_track
├── backend/models/              empty (.gitkeep)
├── emora-frontend/              React SPA
│   ├── src/pages/               Login, Boot, Chat (tab "E.M.O.R.A."), Mood, Analytics, Reminders, Profile, Settings
│   ├── src/components/EmoraCore 3D avatar (Character, avatars registry, blink / lip-sync / gaze / expression hooks)
│   ├── src/components/…         FaceScanner (login animation), HUD (EmotionPanel, SpeechHud), OfflineBanner, Particles
│   ├── src/hooks/               camera, voice session (VAD), speech recognition, TTS, face tracking, location, polling
│   ├── src/services/            axios API wrappers per domain
│   ├── src/assets/avatars/      15 GLB/VRM avatars (~147 MB)
│   ├── public/avatar.glb        default avatar (VRoid VRM 1.0)
│   └── e2e/                     Puppeteer scripts: routes, flows, handsfree
├── tests/                       pytest suites (API + emotion service)
├── evaluation/                  offline accuracy scripts + results/evaluation_report.md
├── scripts/                     capture_eval_samples.py, check_avatar.py
├── assets/models/               avatar source files (.blend, older GLBs)
├── data/                        SQLite DB, memories/*.json, personal files (not audited)
├── docs/, *.md                  design docs; mostly from the older Streamlit version (see §6)
├── Dockerfile, docker-compose.yml, setup.sh / .ps1 / .bat
└── .streamlit/                  leftover config; nothing uses it
```

---

## 3. Technology Stack

### 3.1 Frontend (versions from `node_modules`)

| Library | Version | Purpose | Evidence |
|---|---|---|---|
| react / react-dom | 19.2.8 | UI | `src/main.tsx`, 37 files import react |
| vite + @vitejs/plugin-react | 8.2.2 / 6.1.0 | Dev server, build, `/api` proxy | `vite.config.ts:7,14-22` |
| typescript | 6.0.3 | Types | `tsconfig.app.json` |
| react-router-dom | 7.18.2 | Routing, guards | `App.tsx`, `AppShell.tsx`, `BootPage.tsx` |
| three | 0.185.1 | 3D, GLTF loading, FBX→GLB conversion | `EmoraCore/Character.tsx`, `avatars.ts` |
| @react-three/fiber | 9.7.0 | React renderer for three | `EmoraCore.tsx`, hooks/* |
| @react-three/drei | 10.7.8 | `useGLTF`, `useAnimations`, `PresentationControls`, `useProgress` | `Character.tsx`, `EmoraCore.tsx`, `SettingsPage.tsx` |
| framer-motion | 13.1.1 | Animations | 14 files (e.g. `SilentScan.tsx`, `EmotionPanel.tsx`) |
| recharts | 3.10.1 | Charts | `MoodPage.tsx`, `AnalyticsPage.tsx` |
| @tsparticles/react + slim | 4.3.2 | Particle background | `components/Particles/ParticlesBg.tsx` |
| axios | 1.19.0 | HTTP client, JWT header, redirect on 401 | `services/api.ts:39-56` |
| lucide-react | 1.33.0 | Icons | 14 files |
| tailwindcss + @tailwindcss/vite | 4.3.3 | Imported, but **no utility classes are used**; only the CSS reset applies | `index.css:1`, `vite.config.ts:3,7` |
| oxlint | 1.79.0 | Lint (dev) | `package.json` scripts |
| puppeteer-core | 25.8.0 | E2E scripts (dev) | `e2e/*.mjs` |

### 3.2 Backend (versions installed in `venv`, Python 3.12.13)

| Library | Version | Purpose | Evidence |
|---|---|---|---|
| fastapi | 0.140.13 | API | `main.py`, `routers/*` |
| uvicorn[standard] | 0.52.0 | ASGI server (command line) | `setup.sh:66`, `docker-compose.yml:6` |
| SQLAlchemy | 2.0.51 | ORM on SQLite | `database.py`, `models.py` |
| python-dotenv | 1.2.2 | `.env` loading | `config.py:2` |
| python-multipart | 0.0.32 | `Form` / `File` uploads (used implicitly) | `auth.py`, `emotion.py`, `stt.py` |
| PyJWT | 2.13.0 | HS256 tokens | `services/jwt_service.py:14-35` |
| cryptography | 50.0.1 | Fernet encryption of provider keys | `services/crypto_service.py:10-22` |
| openai | 2.50.0 | OpenAI, Groq, xAI, NVIDIA (OpenAI-compatible) | `services/llm_service.py:172-223` |
| anthropic | 1.4.0 | Claude | `services/llm_service.py:110-169` |
| opencv-python | 4.9.0.80 | Frame decoding, Haar cascades | `camera.py`, `services/face_track_service.py:28-30` |
| deepface (+ tensorflow 2.16.1, tf-keras) | 0.0.100 | Face embeddings, face emotion | `face_service.py:32-36`, `emotion_service.py:116-137` |
| torch | 2.13.0 | Model runtime and device selection | `stt_service.py`, `emotion_service.py` |
| transformers | 5.17.0 | wav2vec2 and DistilRoBERTa pipelines | `emotion_service.py:157-177,313` |
| nano-parakeet | 0.2.1 | Main speech-to-text | `stt_service.py:31-33` |
| openai-whisper | 20250625 | Speech-to-text fallback | `stt_service.py:41-42` |
| librosa | 0.11.0 | Audio decoding fallback, prosody features | `emotion_service.py:218-241` |
| edge-tts | 7.2.8 | Text-to-speech | `services/tts_service.py` |
| psutil | 7.2.2 | Battery and memory for system info | `action_service.py:261,278` |
| soundfile | 0.14.0 | Only used by `scripts/capture_eval_samples.py:89` | not used by the backend |
| scikit-learn | 1.9.0 | Only used by `evaluation/metrics.py:28` | not used by the backend |
| requests | 2.34.2 | **Never imported** | grep found no imports |
| pytest / httpx | 9.1.1 / 0.28.1 | Tests and `TestClient` | `tests/` |
| sounddevice | not installed | Imported by `scripts/capture_eval_samples.py` but **missing from requirements** | |

### 3.3 Browser APIs used

| API | Where |
|---|---|
| `navigator.mediaDevices.getUserMedia` | `hooks/useCamera.ts:15`, `hooks/useVoiceSession.ts:169-175` |
| `MediaRecorder` (opus webm) | `useVoiceSession.ts:354-363` |
| Web Audio `AudioContext` / `AnalyserNode` / oscillator | `useVoiceSession.ts:178-181`, `services/settings.ts` (`chime`) |
| `SpeechRecognition` / `webkitSpeechRecognition` | `hooks/useSpeechRecognition.ts:25-31`, `useVoiceSession.ts:213-251` |
| Canvas `toBlob` (JPEG frames) | `useCamera.ts:41-49`, `useFaceTracking.ts` |
| `HTMLAudioElement` playback | `hooks/useTTS.ts` |
| `Notification` | `pages/Chat/ChatPage.tsx:101-103`, `Settings/PreferenceCards.tsx` (`AlertsCard`) |
| `navigator.geolocation` | `hooks/useLocation.ts` |
| `localStorage` | `services/api.ts:24-27`, `hooks/usePersistentState.ts`, `avatars.ts`, `useLocation.ts` |
| `fetch` to `nominatim.openstreetmap.org` | `useLocation.ts:32` |

---

## 4. Implemented Features

### 4.1 Face Login and Enrollment
**Status:** ✅ Implemented (with the caveats in §5)
- **How it works:**
  1. The user speaks their name (browser `SpeechRecognition`), and the app calls `POST /api/auth/identify`.
  2. A hidden webcam captures up to 3 JPEG frames.
  3. The frame goes to `POST /api/login` for a known name or `POST /api/register` for a new one.
  4. The backend builds a DeepFace **Facenet** embedding (opencv detector, `enforce_detection=True`) and L2-normalises it.
  5. It compares against stored embeddings by distance with a **0.8 threshold**. On success it creates a JWT and a session row.
- **Files:**
  - Backend: `backend/app/services/face_service.py:28-92`, `backend/app/routers/auth.py:49-107`
  - Frontend: `emora-frontend/src/pages/Login/LoginPage.tsx:128-230`, `src/services/auth.ts:11-27`, `src/hooks/useCamera.ts`, `src/components/FaceScanner/SilentScan.tsx` (animation only)
- **Evidence:** `DeepFace.represent(model_name="Facenet")` at `face_service.py:32-36`; `recognize_face`, `register_face`; `threshold = 0.8` at `face_service.py:86`.

### 4.2 Authentication (JWT)
**Status:** ✅ Implemented
- **How it works:**
  - HS256 tokens carry `sub` (user id) and `iat`, and expire after 7 days.
  - `get_current_user` validates the Bearer token and loads the user.
  - The frontend keeps the token in localStorage. Axios attaches it to requests and clears auth on a 401.
- **Evidence:** `services/jwt_service.py:14-35`, `dependencies.py:21-39`, `emora-frontend/src/services/api.ts:39-56`, `App.tsx:18-28` (`RequireAuth` / `GuestOnly`).

### 4.3 Emotion Detection (face, voice, text)
**Status:** ✅ Implemented
- **Face:** `DeepFace.analyze(actions=["emotion"])`, trying the `opencv` detector then `mtcnn` (`emotion_service.py:116-137`).
- **Voice:** two wav2vec2 checkpoints, tried in order.
  - `superb/wav2vec2-base-superb-er` (4 classes), then `ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition` (`emotion_service.py:43-46,142-190`).
  - A checkpoint whose classifier head is untrained is rejected.
  - If neither loads, a pitch/loudness/speaking-rate rule is used (`:224-264`).
  - Audio is decoded with ffmpeg, falling back to librosa (`:193-221`).
- **Text:** `j-hartmann/emotion-english-distilroberta-base` (`:51,302-349`), with a word-list fallback.
- **Label mapping:** all model labels fold into 7 emotions via `_LABEL_ALIASES` (`:54-62,91-98`).
- **Endpoints:** `POST /api/emotion/face`, `/api/emotion/voice`, `/api/emotion/analyze` (`routers/emotion.py:39-115`). `EmotionLog` rows are written at `emotion.py:24-35`.

### 4.4 Emotion Fusion and Smoothing
**Status:** ✅ Implemented
- **How it works:**
  - Base weights are face 0.45, voice 0.30, text 0.25.
  - Each weight is scaled by how peaked that modality's scores are.
  - Confidence is scaled by how many modalities agree.
  - A per-user moving average (α = 0.45) smooths readings over time.
- **Evidence:** `emotion_service.py:356-436` (`fuse_emotions`, `smooth`), `_BASE_WEIGHTS` at `:356`, `_EMA_ALPHA` at `:29`; tests in `tests/test_emotion_service.py` (Fusion 7, Smoothing 4).
- **Frontend:** `ChatPage.tsx:134-147` (`readEmotion` → `services/emotion.ts:46-57`). An ambient face scan runs every 6 s (`ChatPage.tsx:45,155-161`). `components/HUD/EmotionPanel.tsx:47-104` shows the real scores, breakdown and agreement.

### 4.5 Speech-to-Text
**Status:** ✅ Implemented (race condition in §5)
- **Server:** NVIDIA **Parakeet-TDT 0.6B v3** via `nano_parakeet`, falling back to **Whisper tiny**. Input is converted to 16 kHz WAV with ffmpeg (`stt_service.py:28-91`). `POST /api/stt` (`routers/stt.py:8-15`).
- **Browser:** continuous `SpeechRecognition` (en-US) in the hands-free loop (`useVoiceSession.ts:213-251`), and one-shot recognition for the name at login (`useSpeechRecognition.ts`).

### 4.6 Hands-free Voice Conversation (VAD, echo guard)
**Status:** ✅ Implemented
- **Microphone:** echo cancellation, noise suppression and auto gain on (`useVoiceSession.ts:169-175`).
- **Voice activity detection:** RMS measured every 50 ms against an adaptive noise floor. Speech starts after 3 loud frames and ends after 900 ms of silence (`:56-76,372-427`).
- **Echo guard:** the mic is disabled while Emora speaks or thinks, reopens after a 650 ms cooldown, and any transcript that is 60% or more Emora's own last reply is dropped (`:107-115,449-500`).
- **Fallback:** if the browser gives no transcript, the recorded audio goes to `/api/stt` (`ChatPage.tsx:223-226`).
- **Tested by:** `e2e/handsfree.mjs`.

### 4.7 Text-to-Speech
**Status:** ✅ Implemented
- `edge-tts`, default voice `en-IN-NeerjaExpressiveNeural`.
- Switches to `hi-IN-SwaraNeural` for Hindi (Devanagari) text on plain English voices.
- `clean_for_speech` strips markdown, HTML and emoji first.
- **Evidence:** `services/tts_service.py:14-52`, `POST /api/tts` (`routers/assistant.py:37-54`).
- **Frontend:** `hooks/useTTS.ts` (reads voice and speed from localStorage); voice picker in `Settings/PreferenceCards.tsx` (`VoiceCard`).
- **Tested by:** `tests/test_api.py::TestSpeech` (3 tests).

### 4.8 Chat (LLM, emotion-aware)
**Status:** ✅ Implemented
- **Order of operations:** a whitelisted desktop action is tried first; otherwise the message goes to the active LLM.
- **History:** the last 10 interactions (`routers/chat.py:72-82`).
- **System prompt** (`chat_service.py:175-220`) includes:
  - the base prompt and the tone / reply-length / language preferences
  - the user's name
  - an emotion hint, skipped below 0.35 confidence (`chat.py:48-58`)
  - the 7-day mood trend (`mood_service.py:25-46`)
  - saved memories, and location on vision turns
- **Tool loop:** at most 4 rounds (`llm_service.py:21`).
  - Anthropic: `tool_use` blocks, max_tokens 4096, refusal handled (`:110-169`).
  - OpenAI-compatible: `tool_calls` (`:172-223`).
- **Reasoning:** `<think>` blocks are stripped, including unclosed ones (`llm_service.py:26-34`; 6 tests).
- **Frontend:** `ChatPage.tsx:164-217`; `services/chat.ts`.

### 4.9 Vision Chat (camera questions)
**Status:** ✅ Implemented
- A message that matches the vision-intent regex (`services/vision.ts:14-19`) sends a frame to `POST /api/chat/vision`. The cap is 4 MB (`chat.py:45,157-165`).
- Only models on a per-provider vision allowlist accept it (`providers.py:116-125`, `llm_service.py:240-246`).
- **Tested by:** `TestVisionChat` (5), `TestVisionCapability` (4).

### 4.10 LLM Provider Management
**Status:** ✅ Implemented
- **Providers:** OpenAI, Anthropic, Groq, xAI, NVIDIA (`services/providers.py:29-93`).
- **Keys:** Fernet-encrypted with a key derived from `SHA-256(SECRET_KEY)` (`crypto_service.py:17-22`). Only a masked form is returned. A test call is available (`settings.py:37-148`).
- **Selection:** the active DB row wins; `.env` `LLM_API_KEY` is the fallback (`llm_service.py:54-82`). The DB currently has **0 `provider_keys` rows**, so chat runs on the `.env` fallback.
- **Frontend:** `pages/Settings/SettingsPage.tsx` (provider dropdown).

### 4.11 Memory
**Status:** ✅ Implemented
- The `save_memory` tool writes a JSON list to `data/memories/user_<id>.json`, and all memories go into every prompt (`chat_service.py:76-118,137-172`).
- Memories can be exported and cleared (`settings.py:202-260`).

### 4.12 Run-Python Tool
**Status:** ✅ Implemented (security risk, see §11)
- Runs `subprocess.run(["python","-c",code], timeout=15)` (`chat_service.py:121-133`).
- The tool is withheld and refused when `allow_code` is off (`:242-247`).

### 4.13 Desktop Commands
**Status:** ✅ Implemented, with the bugs in §5
- **Actions:** `system_info`, `open_url`, `open_folder`, `create_folder`, `create_file`, `open_app` (macOS `open -a`).
- **Parsing:** keyword matching, names checked against `^[\w .\-()]{1,80}$`, bare `..` rejected (`services/action_service.py:33,56-150,198-251`).
- **Gate:** `try_action` checks `allow_actions` (`chat_service.py:51-63`). Used by `chat.py:84` and `assistant.py`.

### 4.14 Reminders (backend)
**Status:** ✅ Implemented (the UI is broken, see §5)
- **Endpoints:** create, list, complete (`routers/reminders.py:47-98`).
- **Repeat:** hourly, daily or weekly, rolled forward past now (`reminder_service.py:84-92`).
- **Delivery:** `GET /reminders/due` marks each item delivered; items more than 2 h late are skipped (`reminder_service.py:21,39-81`).
- **Presets:** water, posture, break, sleep (`reminder_service.py:31-36`; endpoints `reminders.py:120-141`).
- **Tested by:** `TestReminders` (4), `TestReminderDelivery` (12).

### 4.15 Due-Reminder Alerts and Notifications
**Status:** ✅ Implemented (only on the E.M.O.R.A. tab)
- `useDueReminders` polls `/reminders/due` every 30 s (`useDueReminders.ts:21,36`).
- The chat page then:
  - shows a toast
  - plays a chime (unless quiet hours)
  - sends a `Notification` if the tab is hidden and permission is granted
  - speaks the reminder (`ChatPage.tsx:92-108`)
- Settings are in `Settings/PreferenceCards.tsx` (`AlertsCard`). `inQuietHours` in `services/settings.ts` handles windows that cross midnight.

### 4.16 Mood Trend and Self-care Nudges
**Status:** ✅ Implemented (delivery gap in §5)
- **Trend:** needs at least 3 fused readings in 7 days (`mood_service.py:25-46`).
- **Nudge:** fires on 3 or more consecutive negative fused readings among the last 5, with a 12 h cooldown (`mood_service.py:71-100`), triggered from `/chat` (`chat.py:120`).
- **Tested by:** `TestMoodService` (5).

### 4.17 3D Avatar
**Status:** ✅ Implemented
- **Rendering:** GLB/VRM through `useGLTF`, with a loader plugin that recovers blendshape names stored per primitive (`EmoraCore/avatars.ts`). VRM 0.x models are turned to face the camera and their bone rotations mirrored (`Character.tsx`, `useRestPose.ts`, `useEyeTracking.ts`).
- **Face and body:** blendshape blink, lip-sync and expressions (`hooks/useBlink.ts`, `useLipSync.ts`, `useExpression.ts`, `morphTargets.ts`). Bone-based blink and jaw for rigs without blendshapes (Sophia, RenderPeople). Built-in idle animations play (`Character.tsx`, `useAnimations`).
- **Picker:** the `src/assets/avatars/` folder is globbed automatically, and Settings shows a live preview (`SettingsPage.tsx`).
- **Other files:** `public/avatar.glb` (default), 15 models in the avatars folder.

### 4.18 Head Tracking (avatar gaze)
**Status:** ✅ Implemented
- **Backend:** OpenCV Haar cascades (frontal, then profile) on a 320 px, histogram-equalised frame. Returns x/y in [-1, 1] and a scale (`face_track_service.py:22-75`). `POST /api/face/track` (`routers/emotion.py:117-135`).
- **Frontend:** posts a 320 px JPEG every 140 ms (`useFaceTracking.ts:28,72-117`). The head bone turns by an offset from its rest pose (`useEyeTracking.ts`).
- **Tested by:** `TestFaceTracking` (6).

### 4.19 Settings (preferences, privacy)
**Status:** ✅ Implemented
- **Preferences:** `allow_actions`, `allow_code`, tone, reply length, language, stored in `user_preferences` (`models.py:25-43`, `settings.py:151-192`).
- **Data:** export (`GET /settings/export`, no face embedding), clear chats / mood / memories (`DELETE /settings/data/{kind}`), delete account with the typed name checked on the server (`settings.py:195-283`).
- **Per-browser:** voice and speed, chat toggles, reminder alerts, avatar (`hooks/usePersistentState.ts`, `services/settings.ts`).
- **UI:** `pages/Settings/SettingsPage.tsx`, `PreferenceCards.tsx`.
- **Tested by:** `TestPreferences` (6), `TestPrivacy` (5), `TestProviderKeys` (8), `TestCrypto` (4).

### 4.20 Analytics and Mood Pages
**Status:** ✅ Implemented (data bugs in §5)
- `GET /api/mood/history` (most common emotion per day) and `GET /api/analytics` (counts, common emotion) (`routers/analytics.py:17-76`).
- Recharts line, pie and bar charts on real data (`pages/Mood/MoodPage.tsx:28`, `pages/Analytics/AnalyticsPage.tsx:25,42-82`).

### 4.21 Profile
**Status:** ✅ Implemented (read-only)
- `GET /api/profile` returns name, join date, number of emotion logs and emotion distribution (`analytics.py:78-89`). Shown by `pages/Profile/ProfilePage.tsx:13,22-51`.

### 4.22 Location
**Status:** ✅ Implemented
- Opt-in `navigator.geolocation`, reverse-geocoded once through OpenStreetMap Nominatim and cached in localStorage (`hooks/useLocation.ts:32,70`).
- Sent with vision chat turns (`ChatPage.tsx:194`). The prompt uses it at `chat_service.py`.

### 4.23 Camera and Microphone
**Status:** ✅ Implemented
- Camera: `useCamera.ts` (640×480 `getUserMedia`, canvas capture).
- Microphone: `useVoiceSession.ts` (stream, analyser, recorder).
- Chat toggles are remembered in localStorage (`CHAT_TOGGLES`).

### 4.24 Spontaneous Emotional Check-in
**Status:** ✅ Implemented
- Needs a confident (≥0.5) change between two non-neutral emotions, a 90 s cooldown, and hands-free off. It then sends an instruction to `/chat` (`ChatPage.tsx:249-281`).

### 4.25 Backend Health, Warmup, Offline Banner
**Status:** ✅ Implemented
- `/api/health` reports model readiness; `EMORA_WARMUP` starts daemon warmup threads (`main.py:31-38,62-83`).
- The frontend polls readiness every 4 s until ready (`useBackendReady.ts`). `OfflineBanner` polls every 15 s (`OfflineBanner.tsx:14,21`).

### 4.26 Single-process Serving
**Status:** ✅ Implemented
- When `emora-frontend/dist` exists, FastAPI serves it with a `realpath` check so paths can't escape, and returns 404 for unknown `/api` paths (`main.py:97-123`).
- **Tested by:** `TestSinglePipelineServing` (4).

### 4.27 Evaluation Suite
**Status:** ✅ Implemented (only partly run)
- `evaluation/eval_{text_emotion,fusion,face_emotion,voice_emotion,face_recognition,stt,chatbot}.py`, combined by `run_all.py`.
- The report `evaluation/results/evaluation_report.md` has text emotion 0.829 accuracy (lexicon 0.229), fusion 1.0 and chatbot 6/6.

---

## 5. Partially Implemented Features

| Feature | What exists | What is missing or broken | Evidence |
|---|---|---|---|
| **Reminders page (UI)** | Title plus free-text time, list, complete button | **The data format doesn't match the backend.** The UI sends `{title, time}` but the backend expects `scheduled_at`, so the time is dropped and **UI-created reminders never come due**. The UI reads `r.completed` / `r.time`, but the API returns `is_completed` / `scheduled_at`, so the time shows blank and the ACTIVE count is wrong. `PATCH /complete` requires a JSON body (`ReminderUpdate`) and the UI sends none, so it likely returns 422. No date picker, repeat, description or presets in the UI. | `pages/Reminders/RemindersPage.tsx:54,76-82`; `services/reminders.ts:15-27`; `routers/reminders.py:23-45,81-86` |
| **Reminder edit/delete** | — | No endpoint and no UI | `routers/reminders.py` (only POST, GET, PATCH complete) |
| **Reminder presets** | `GET/POST /reminders/presets` | The frontend never calls them | grep of `emora-frontend/src` for `presets`: none |
| **Face login failure path** | Success works | **(traced)** `setPhase('verifying')` re-runs the effect, and its cleanup sets `cancelled=true`. Success still redirects because `GuestOnly` sees the token. A failed attempt exits the loop silently, so the UI stays on "VERIFYING" with the camera on and never reaches `failed`. | `LoginPage.tsx:188-230` |
| **Face liveness / anti-spoofing** | — | DeepFace `anti_spoofing` is never used, so a photo can likely pass | `face_service.py:32-36` |
| **Sessions / logout** | `sessions` rows written at login | Never read for auth; `get_session_by_token` has no callers; no logout endpoint; tokens can't be revoked; `Interaction.session_id` never set. Frontend logout only clears localStorage. | `session_service.py:10-24`, `dependencies.py:21-39`, `auth.py:30-35` |
| **Server STT** | Parakeet → Whisper | Every request uses the **same temp files** `_emotion_audio_raw.tmp` / `_emotion_audio.wav`, so parallel requests can swap transcripts. No ffmpeg timeout. A missing ffmpeg raises an uncaught error (500). Language fixed to "en". | `stt_service.py:45-62,72-81` |
| **Desktop commands** | 6 actions | **`open_url` is broken:** `Path("https://x.com")` becomes `https:/x.com` before being passed to `open`. `create_file` **truncates existing files** (`write_text("")`). Replies always say "on your desktop", even for the home folder. Keywords like "what day" or "battery" take over normal chat. The URL regex only matches when the whole message is a URL. Windows unsupported. | `action_service.py:34,100,105,204,239-249` |
| **Mood nudges** | Created during chat, shown as a toast | Nudge rows have no `scheduled_at`, so `/reminders/due` never delivers them | `mood_service.py:71-100` |
| **Mood page** | Real API data in charts | X-axis weekdays are hardcoded `Mon..Sun` by index, so they don't match the real dates. Empty data falls back to a fake "neutral" slice. The backend groups by UTC but labels days with local dates. | `MoodPage.tsx:41,93-94,108`; `analytics.py:17-53` |
| **Analytics** | Counts and chart | `avg_emotion` is the same value as `common_emotion`. The count includes face, voice and fused rows. The ambient scan writes about 600 rows/hour, inflating counts. | `analytics.py:66-67`; `emotion.py:113`; `ChatPage.tsx:45` |
| **Profile** | Read-only stats | `preferred_language` hardcoded `"en"` (ignores preferences); nothing editable | `analytics.py:85-87` |
| **Chat history in UI** | Backend stores every interaction | No history endpoint; the UI keeps messages only in React state, so they're lost on reload or navigation | `ChatPage.tsx:71` |
| **Location in chat** | Location cached | Sent only on vision turns; `/chat` has no location parameter | `services/chat.ts:10-17`, `ChatPage.tsx:194` |
| **Camera preview toggle** | Toggle exists | **(traced)** Toggling swaps which `<video>` holds `videoRef`, but `srcObject` is only set once at start. Capture then returns null, so face emotion, tracking and vision stop until the camera restarts. | `ChatPage.tsx:428-441`; `useCamera.ts:20-22` |
| **Lip-sync** | Blendshape or jaw movement while speaking | Driven by random amplitudes, not the TTS audio | `useLipSync.ts:47-48` |
| **Offline banner** | Health poll | Says "CHECK :8001", but the API default is :8000 | `OfflineBanner.tsx:52`; `vite.config.ts:18` |
| **AppShell status chips** | Displayed | "SYSTEM ONLINE" and "IDENTITY VERIFIED" are fixed text; "JWT · AUTHENTICATED" only checks that a token exists | `AppShell.tsx:77,98,100` |
| **Boot page** | Animation | Status lines ("FACE RECOGNITION: ONLINE") are a hardcoded array with no health check | `BootPage.tsx:13-20` |
| **DeepFace warmup** | STT, text and voice models warmed | Facenet and face emotion are not warmed and not reported in `/health`, so the first login is slow | `main.py:31-38,62-83` |
| **`/api/assistant`** | Endpoint works | No frontend caller since J.A.R.V.I.S. was removed; weaker copy of `/chat` | `routers/assistant.py:57-91` |
| **`/api/emotion/face`, `/voice`** | Endpoints plus TS wrappers | `analyzeFaceEmotion` / `analyzeVoiceEmotion` have no callers | `services/emotion.ts:31,38` |
| **Evaluation** | Scripts for 7 areas | Face emotion, voice emotion and face ID show "No labelled data" (`data/eval/` missing); STT "Skipped" | `evaluation/results/evaluation_report.md` |
| **Windows setup** | `setup.ps1` / `.bat` | `requirements-windows.txt` lacks PyJWT, cryptography, anthropic, nano-parakeet, torch, transformers, edge-tts and psutil, so the backend fails at import. The scripts tell you to run the deleted Streamlit app. | `requirements-windows.txt`; `setup.ps1:75`; `setup.bat:78` |
| **Docker** | Compose runs backend + Vite | Slim image has no ffmpeg or OpenGL/GLib libraries (opencv); TensorFlow unpinned; desktop actions can't work in a container | `Dockerfile`, `docker-compose.yml` |

---

## 6. Missing Features

| Feature | Referenced in | Why it counts as missing |
|---|---|---|
| Wake word ("Hey Emora") | `enhancement_plan.md:1490` | grep for `hey emora`, `wake.?word`, `wake_detected` in the code found nothing |
| Offline LLM / STT (Ollama, whisper.cpp) | `phase.md` 4C, `plan.md:74` | grep for `ollama`, `whisper.cpp` found nothing; `OfflineBanner` only detects a lost backend |
| Push notifications (service worker) | Implied by reminders roadmap | grep for `serviceWorker`, `PushManager` found nothing; only the in-page `Notification` API exists |
| Emoji / sticker suggestions | `phase.md` 2D | grep for `sticker` found nothing |
| Permanent `skills/` folder for generated code | `emora_feature_status.md:34` | grep for `skills/` found nothing |
| Mood-driven desktop actions (e.g. play music when sad) | `emora_feature_status.md:42` | No emotion-triggered path in `action_service.py` |
| Workflow automation ("open VS Code and pull latest") | `phase.md` 4C | No chained or git actions in `action_service.py` |
| IP Webcam (phone camera) | `docs/explainer.md` 3.10, `setup.sh:77` | grep for `shot.jpg`, `ip.?webcam` found nothing |
| Logout endpoint / token revocation | `docs/explainer.md` 3.8 | No `logout` route; `sessions.is_active` never changed |
| Reminder delete / edit | Expected CRUD | Only POST, GET and PATCH complete exist |
| Chat history view | Backend stores history | No endpoint returns past interactions |
| Face liveness detection | Security for face login | No anti-spoofing code |
| Frontend unit tests | — | No test runner in `package.json`; only Puppeteer scripts |
| **Dead code** | `rabbitScene.ts` (old 2D canvas rabbit), `HUD/PlaceholderPage.tsx` ("COMING SOON"), `useMediaRecorder.ts`, `emora-frontend/patch.cjs` (obsolete patch script), `camera.capture_frame` / `frame_to_bytes`, `session_service.get_session_by_token`, `emotion_service.clear_history`, `.streamlit/` | Nothing imports or calls them (checked by import graph and grep) |
| **Outdated docs** | `docs/*.md`, `plan.md`, `phase.md`, `inspynet-humanoid-upgrade-plan.md`, most of `enhancement_plan.md`, `emora-frontend/README.md` (Vite template); README says "56 backend tests" (there are 104) | They describe the removed Streamlit + Gemini version; files such as `frontend/app.py` and `ai_core.py` don't exist |

---

## 7. AI Pipeline

| Task | Model | Local / Cloud | File |
|---|---|---|---|
| Face identification | DeepFace **Facenet** embeddings (opencv detector), distance threshold 0.8 | Local | `backend/app/services/face_service.py:28-92` |
| Face emotion | DeepFace emotion model (opencv → mtcnn detector) | Local | `services/emotion_service.py:116-137` |
| Voice emotion | `superb/wav2vec2-base-superb-er` → `ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition` → prosody rule | Local | `services/emotion_service.py:43-46,142-264` |
| Text emotion | `j-hartmann/emotion-english-distilroberta-base` → word-list fallback | Local | `services/emotion_service.py:51,302-349` |
| Emotion fusion | Weighted, confidence and agreement scaled, EMA α = 0.45 | Local | `services/emotion_service.py:356-436` |
| Speech-to-text | `nvidia/parakeet-tdt-0.6b-v3` (nano-parakeet) → Whisper `tiny` | Local | `services/stt_service.py:28-91` |
| Speech-to-text (browser) | Web Speech API (Chrome sends audio to Google) | Cloud (browser vendor) | `hooks/useVoiceSession.ts:213-251`, `useSpeechRecognition.ts` |
| Head detection | OpenCV Haar cascades (frontal + profile) | Local | `services/face_track_service.py:22-75` |
| Chat / vision / tools | OpenAI `gpt-4o-mini`*, Anthropic `claude-opus-5`*, Groq `llama-3.3-70b-versatile`*, xAI `grok-3`*, NVIDIA `llama-3.3-nemotron-super-49b-v1`*, or `.env` `LLM_MODEL` | Cloud | `services/providers.py:29-93`, `services/llm_service.py` |
| Text-to-speech | Microsoft Edge neural voices (`en-IN-NeerjaExpressiveNeural` default) | Cloud | `services/tts_service.py` |
| Reverse geocoding | OpenStreetMap Nominatim | Cloud | `emora-frontend/src/hooks/useLocation.ts:32` |

\* The default model; users can pick others in Settings.

---

## 8. Data Flow (runtime)

**Login**
```
User speaks name → Browser SpeechRecognition → POST /api/auth/identify
→ hidden webcam frame → POST /api/login | /api/register → DeepFace Facenet → JWT + session row
→ localStorage (emora_token, emora_user) → /chat
```

**Conversation turn** (typed, or hands-free)
```
Mic (VAD) ─┬─ browser transcript ─────────────────┐
           └─ no transcript → POST /api/stt (Parakeet/Whisper)
Camera frame + audio + text → POST /api/emotion/analyze → face / voice / text models → fusion → EMA → EmotionLog
Message → POST /api/chat  (or /api/chat/vision with a frame)
   → try_action (desktop command, if allowed) ─ hit → plain-text confirmation
   → else build prompt (prefs, emotion hint, mood trend, memories, location)
        → LLM provider (tool loop: run_python / save_memory, ≤4 rounds)
   → Interaction row → maybe_create_nudge
Reply → React chat bubble → POST /api/tts (edge-tts, chosen voice) → <audio> playback
      → avatar lip-sync + expression (from emotion) + gaze (POST /api/face/track every 140 ms)
```

**Background (client-driven)**
```
/api/emotion/analyze every 6 s (face only) · /api/reminders/due every 30 s → toast / chime / Notification / TTS
/api/health every 15 s (banner) and every 4 s until ready
```

---

## 9. API Inventory

| Method | Route | Purpose | Auth |
|---|---|---|---|
| GET | `/api/health` | Liveness and model readiness | none |
| POST | `/api/auth/identify` | Is this name enrolled? (+ enrolled count) | **none** |
| POST | `/api/register` | Enroll a face, returns JWT | **none** |
| POST | `/api/login` | Face login, returns JWT | **none** |
| POST | `/api/chat` | Text chat | JWT |
| POST | `/api/chat/vision` | Chat with a webcam frame | JWT |
| POST | `/api/stt` | Speech-to-text | **none** |
| POST | `/api/tts` | Text-to-speech (MP3) | **none** |
| POST | `/api/assistant` | Action-or-chat (no frontend caller) | JWT |
| POST | `/api/emotion/face` | Face emotion | JWT |
| POST | `/api/emotion/voice` | Voice emotion | JWT |
| POST | `/api/emotion/analyze` | Fused emotion | JWT |
| POST | `/api/face/track` | Head position for avatar gaze | **none** |
| POST | `/api/reminders` | Create reminder | JWT |
| GET | `/api/reminders` | List reminders | JWT |
| PATCH | `/api/reminders/{id}/complete` | Mark complete (JSON body required) | JWT |
| GET | `/api/reminders/due` | Due reminders (marks delivered) | JWT |
| GET | `/api/reminders/presets` | Activity presets (no frontend caller) | JWT |
| POST | `/api/reminders/presets/{preset_id}` | Add preset (no frontend caller) | JWT |
| GET | `/api/mood/history` | Most common emotion per day | JWT |
| GET | `/api/analytics` | Totals and common emotion | JWT |
| GET | `/api/profile` | Profile stats | JWT |
| GET | `/api/settings/providers` | Provider catalog and masked keys | JWT |
| PUT | `/api/settings/providers` | Save / activate provider key | JWT |
| DELETE | `/api/settings/providers/{provider_id}` | Remove key | JWT |
| POST | `/api/settings/providers/test` | Test a key | JWT |
| GET | `/api/settings/preferences` | Read preferences | JWT |
| PUT | `/api/settings/preferences` | Update preferences (partial) | JWT |
| GET | `/api/settings/export` | Export user data | JWT |
| DELETE | `/api/settings/data/{kind}` | Clear chats / mood / memories | JWT |
| POST | `/api/settings/account/delete` | Delete account (typed name) | JWT |
| GET | `/{full_path}` | SPA fallback (only if `dist/` exists) | none |

**32 routes** (from an AST scan of `backend/`; auth means `get_current_user` is in the handler signature).

---

## 10. Database Audit

### 10.1 SQLite tables (`data/emotion_assistant.db`, from `models.py` and the live `.schema`)

| Table | Columns | Relationships | Rows (live) |
|---|---|---|---|
| `users` | id PK, name, face_embedding (JSON text), created_at | 1:N sessions, emotion_logs, interactions, reminders; 1:1 preference (ORM cascade delete) | 8 |
| `sessions` | id PK, user_id FK, token (unique), is_active, created_at, expires_at | N:1 user | 70 |
| `interactions` | id PK, user_id FK, session_id FK (never set), query_text, response_text, emotion_label, emotion_confidence, emotion_vector JSON, created_at | N:1 user, N:1 session | 308 |
| `emotion_logs` | id PK, user_id FK, source (face / voice / fused), emotion, confidence, created_at | N:1 user | 2,967 |
| `reminders` | id PK, user_id FK, title, description, scheduled_at, is_completed, is_mood_triggered, repeat, notified_at, created_at | N:1 user | 4 |
| `provider_keys` | id PK, provider (unique), api_key (Fernet), model, is_active, created_at, updated_at | **no user_id** (shared by all users) | 0 |
| `user_preferences` | user_id PK/FK, allow_actions, allow_code, tone, reply_length, language | 1:1 user | 1 |

Notes:
- There are no migrations. `Base.metadata.create_all` runs at startup (`main.py:31`) and in `init_db.py`.
- SQLite doesn't enforce foreign keys by default; deletes rely on ORM cascades.

### 10.2 JSON / files
| Path | Contents | Code |
|---|---|---|
| `data/memories/user_<id>.json` | Saved facts (list of strings) | `chat_service.py:76-118` |
| `data/memories_<id>.json` | Legacy memory file (still read and deleted) | `chat_service.py` |
| `$TMPDIR/_emotion_audio_raw.tmp`, `_emotion_audio.wav` | STT temp audio (shared, never deleted) | `stt_service.py:47-48` |

### 10.3 localStorage keys (frontend)
| Key | Purpose | Code |
|---|---|---|
| `emora_token`, `emora_user` | JWT and user | `services/api.ts:3-4,24-27` |
| `emora_avatar` | Selected avatar | `components/EmoraCore/avatars.ts` |
| `emora_voice_v2` | TTS voice and speed | `services/settings.ts` (`VOICE_KEY`) |
| `emora_chat_voice`, `emora_chat_handsfree`, `emora_chat_camera`, `emora_chat_preview` | Chat toggles | `services/settings.ts` (`CHAT_TOGGLES`) |
| `emora_reminder_alerts` | Notifications, chime, quiet hours | `services/settings.ts` (`ALERTS_KEY`) |
| `emora_location` | Cached city-level location | `hooks/useLocation.ts` |

In-memory only: per-user emotion smoothing state (`emotion_service.py:28-29`), lost on restart.

---

## 11. Security Audit

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **Critical** | **Default `SECRET_KEY` + `run_python` = remote code execution.** With the default key anyone can forge a JWT for any user. `/chat` then reaches `run_python`, which runs arbitrary Python with no sandbox; `allow_code` defaults on. `setup.sh`, `docker-compose.yml` and `docs/explainer.md` bind uvicorn to `0.0.0.0` (LAN-reachable). The same key also decrypts stored provider keys. | `config.py:7`; `jwt_service.py:23-30`; `chat_service.py:121-133`; `models.py:38`; `setup.sh:66`; `docker-compose.yml:6`; `crypto_service.py:20` |
| 2 | High | **Open enrollment.** `/register` is unauthenticated and returns a token, so any network client can get chat, code execution and desktop actions. CORS only restricts browsers. | `auth.py:67-81`; `main.py:44-50` |
| 3 | High | **No face liveness.** A photo can likely log in. Failed logins return the distance and threshold, which helps someone tune a spoof. | `face_service.py:32-36`; `auth.py:96-101` |
| 4 | High | **`create_file` truncates existing files.** A name like `.zshrc` passes validation, so a spoken command can empty dotfiles in the home folder. | `action_service.py:128,246` |
| 5 | Medium | **Provider API keys are global.** Any logged-in user can replace, activate or delete the key everyone uses. | `models.py:111-122`; `settings.py:64-119` |
| 6 | Medium | **User enumeration.** `/auth/identify` reveals whether a name is enrolled and the enrolled count. | `auth.py:49-64` |
| 7 | Medium | **Unauthenticated heavy endpoints.** `/api/stt` (no size limit, loads the model, runs ffmpeg), `/api/tts` (unlimited text, outbound to Microsoft), `/api/face/track`. | `stt.py:8-15`; `assistant.py:37-54`; `emotion.py:117-135` |
| 8 | Medium | **No upload size limits** on `/login`, `/register`, `/emotion/*`, `/stt`, `/face/track`. The 4 MB vision cap is checked only after reading the whole file. | `chat.py:158-160` |
| 9 | Medium | **Sessions never checked; no logout or revocation.** A leaked token is valid for 7 days. | `dependencies.py:21-39`; `session_service.py` |
| 10 | Medium | **JWT in localStorage** (any XSS can read it). No CSP. Fonts come from the Google CDN. | `api.ts:24-27`; `index.html:8-12` |
| 11 | Low | **A hardcoded JWT is committed** (user 1). | `emora-frontend/e2e/routes.mjs:5` |
| 12 | Low | **Error messages leak internals** (`TTS failed: {e}`, `Provider error: {e}`, OSError text); the ErrorBoundary shows raw errors. | `assistant.py:49,79`; `chat.py:106`; `ErrorBoundary.tsx:37` |
| 13 | Low | **Keyword matching hijacks chat.** "what day" or "battery" becomes system info; app aliases match inside other words ("word" in "password"). `open_app` launches any installed app by name. | `action_service.py:100,153-195` |
| 14 | Low | **Third-party data flows:** messages, memories and emotion context go to the LLM provider; reply text goes to Microsoft TTS; coordinates go to Nominatim; Chrome's speech recognition sends audio to Google. | §7 |

Protections that are in place:
- Provider keys are Fernet-encrypted and only masked forms are returned.
- No `shell=True` subprocess calls, and no raw SQL (everything goes through the ORM).
- SPA serving uses a `realpath` check so paths can't escape `dist/`.
- Action names are validated with a regex, and `/` and bare `..` are blocked.
- Delete-account checks the typed name on the server.
- `run_python` and desktop actions can each be turned off per user.
- The export leaves out the face embedding.
- No `dangerouslySetInnerHTML` in the frontend.

---

## 12. Performance Observations

| Area | Observation | Evidence | Opportunity |
|---|---|---|---|
| Head-tracking polling | POST `/face/track` every **140 ms** (~7 req/s) while the camera is on | `useFaceTracking.ts:28` | Detect in the browser (MediaPipe / `FaceDetector`) or use a WebSocket |
| Ambient emotion | `/emotion/analyze` every 6 s runs DeepFace **and writes an EmotionLog row** (~600/h) | `ChatPage.tsx:45`; `emotion.py:113` | Log only on change or per turn; batch |
| Model loading | STT and text/voice emotion warmed with locks; **Parakeet/Whisper load without a lock** (can load twice); **DeepFace never warmed** | `stt_service.py:28-43`; `emotion_service.py:31,146,306`; `main.py:31-38` | Add a lock; warm Facenet and emotion |
| Memory | Warmup pins ~2–3 GB; on this 16 GB Mac, session-started servers were killed under memory pressure | `config.py` (`EMORA_WARMUP`) | Keep `EMORA_WARMUP=0` on small machines |
| STT I/O | Shared temp files (race), no cleanup, no ffmpeg timeout | `stt_service.py:45-62` | `tempfile.NamedTemporaryFile` per request; `timeout=` |
| Sync endpoints | DeepFace, STT and LLM calls block worker threads; a new SDK client per call; `run_python` can block up to 15 s × 4 rounds | `llm_service.py:120,184`; `chat_service.py:121-133` | Reuse clients; async LLM calls |
| DB queries per `/chat` | Preferences loaded twice; the 7-day trend pulls all fused rows into Python; the nudge check adds 2 queries | `chat_service.py:56,234`; `mood_service.py:28-36` | Pass prefs through; `GROUP BY` in SQL |
| Analytics / profile / export | Load every EmotionLog row instead of aggregating | `analytics.py:64,83` | SQL aggregation, indexes on `(user_id, created_at)` |
| Login | Parses every user's JSON embedding per attempt | `face_service.py:78-84` | Cache vectors in memory |
| Mic sessions | **(traced)** `getUserMedia` + `new AudioContext()` on every hands-free turn without closing the old ones | `useVoiceSession.ts:167-183` | Reuse one stream and context |
| Re-renders | AppShell clock `setState` every 1 s; VAD `setInterval` every 50 ms | `AppShell.tsx:34`; `useVoiceSession.ts:372` | Isolate the clock in its own component |
| Assets | `src/assets/avatars` is **147 MB** (all copied into `dist/`); `public/` 16 MB | `avatars.ts:7-11` | Compress GLBs (Draco / meshopt, KTX2 textures) |
| Other polling | `/health` every 15 s on every page, every 4 s until ready; `/reminders/due` every 30 s | `OfflineBanner.tsx:21`; `useBackendReady.ts`; `useDueReminders.ts:21` | Acceptable; could share one health poller |
| Chunks | three, recharts and framer-motion are split into their own chunks; pages lazy-loaded | `vite.config.ts:36-42`; `App.tsx:11-16` | Already good |

---

## 13. Evidence-Based Feature Matrix

| Feature | Status | Evidence |
|---|---|---|
| Face enrollment | ✅ Implemented | `face_service.py:45-53`, `auth.py:67-81`, `LoginPage.tsx:198-213` |
| Face login (success path) | ✅ Implemented | `face_service.py:68-92`, `auth.py:84-107` |
| Face login failure / retry UI | 🟡 Partial | `LoginPage.tsx:188-230` (effect cancels itself, traced) |
| Face liveness / anti-spoofing | ❌ Missing | no `anti_spoofing` in `face_service.py` |
| Name identification (spoken) | ✅ Implemented | `auth.py:49-64`, `useSpeechRecognition.ts` |
| JWT authentication | ✅ Implemented | `jwt_service.py:14-35`, `dependencies.py:21-39` |
| Sessions table usage | 🟡 Partial | written `auth.py:30`, never read (`dependencies.py`) |
| Logout / token revocation (server) | ❌ Missing | no route; `sessions.is_active` never changed |
| Face emotion | ✅ Implemented | `emotion_service.py:116-137` |
| Voice emotion | ✅ Implemented | `emotion_service.py:142-264` |
| Text emotion | ✅ Implemented | `emotion_service.py:302-349` |
| Emotion fusion + smoothing | ✅ Implemented | `emotion_service.py:356-436`, `tests/test_emotion_service.py` |
| Emotion HUD panel | ✅ Implemented | `HUD/EmotionPanel.tsx:47-104` |
| Server speech-to-text | 🟡 Partial | works `stt_service.py:70-91`; shared temp-file race `:47-48` |
| Browser speech recognition | ✅ Implemented | `useVoiceSession.ts:213-251`, `useSpeechRecognition.ts` |
| Hands-free VAD + echo guard | ✅ Implemented | `useVoiceSession.ts:56-115,372-500`, `e2e/handsfree.mjs` |
| Text-to-speech + voice picker | ✅ Implemented | `tts_service.py`, `useTTS.ts`, `PreferenceCards.tsx` |
| Hinglish / Hindi replies | ✅ Implemented | `chat_service.py` `LANGUAGES`, `settings.py:159` |
| Text chat with LLM | ✅ Implemented | `chat.py:61-137`, `llm_service.py` |
| Multi-provider LLM (5) | ✅ Implemented | `providers.py:29-93`, `settings.py:37-148` |
| Encrypted provider keys | ✅ Implemented | `crypto_service.py:17-22` |
| Tool loop (run_python, save_memory) | ✅ Implemented | `chat_service.py:121-172`, `llm_service.py:21,110-223` |
| Vision chat | ✅ Implemented | `chat.py:139-170`, `services/vision.ts` |
| Emotion-aware prompt + mood trend | ✅ Implemented | `chat.py:48-58`, `mood_service.py:25-46` |
| Personality preferences | ✅ Implemented | `settings.py:151-192`, `chat_service.py` |
| Long-term memory | ✅ Implemented | `chat_service.py:76-118` |
| Chat history persisted (backend) | ✅ Implemented | `interactions` rows at `chat.py:109-118` |
| Chat history shown after reload | ❌ Missing | no history endpoint; `ChatPage.tsx:71` state only |
| Spontaneous check-in | ✅ Implemented | `ChatPage.tsx:249-281` |
| Desktop commands (create/open/system info) | 🟡 Partial | `action_service.py`; `open_url` broken `:204`; truncation `:246` |
| Desktop commands permission toggle | ✅ Implemented | `chat_service.py:51-63`, `test_api.py` `TestPreferences` |
| Run-code permission toggle | ✅ Implemented | `chat_service.py:242-247` |
| Reminders API (create/list/complete) | ✅ Implemented | `reminders.py:47-98`, `TestReminders` |
| Recurring reminders + due delivery | ✅ Implemented | `reminder_service.py:39-92`, `TestReminderDelivery` |
| Reminders page (UI) | 🟡 Partial | contract mismatch `RemindersPage.tsx:76-82` vs `reminders.py:23-45` |
| Reminder edit / delete | ❌ Missing | no route in `reminders.py` |
| Reminder presets | 🟡 Partial | backend `reminders.py:120-141`, no frontend caller |
| Due-reminder alerts (toast/chime/voice) | ✅ Implemented | `ChatPage.tsx:92-108`, `useDueReminders.ts` |
| Browser notifications | ✅ Implemented | `ChatPage.tsx:101-103`, `AlertsCard` |
| Quiet hours | ✅ Implemented | `services/settings.ts` `inQuietHours` |
| Push notifications (service worker) | ❌ Missing | no `serviceWorker` / `PushManager` |
| Mood-triggered nudges | 🟡 Partial | created `mood_service.py:71-100`; never due (no `scheduled_at`) |
| Mood page charts | 🟡 Partial | real data `MoodPage.tsx:28`; fake weekday labels `:41` |
| Analytics page | 🟡 Partial | `analytics.py:57-76`; avg == common `:66-67` |
| Profile page | 🟡 Partial | read-only; language hardcoded `analytics.py:85-87` |
| 3D avatar rendering + picker | ✅ Implemented | `Character.tsx`, `avatars.ts`, `SettingsPage.tsx` |
| Avatar blink / expressions | ✅ Implemented | `useBlink.ts`, `useExpression.ts`, `morphTargets.ts` |
| Avatar lip-sync | 🟡 Partial | `useLipSync.ts:47-48` (random, not audio-driven) |
| Animated / bone-rig avatars (Sophia) | ✅ Implemented | `Character.tsx` (`useAnimations`), `JAW_BONES` / `EYELID_BONES` |
| Head tracking → avatar gaze | ✅ Implemented | `face_track_service.py`, `useFaceTracking.ts`, `useEyeTracking.ts` |
| Camera capture | ✅ Implemented | `useCamera.ts` |
| Camera preview toggle | 🟡 Partial | `ChatPage.tsx:428-441` swaps `videoRef` (traced) |
| Microphone capture | ✅ Implemented | `useVoiceSession.ts:169-183` |
| Location | 🟡 Partial | `useLocation.ts`; only sent on vision turns `ChatPage.tsx:194` |
| Settings: data export / clear / delete account | ✅ Implemented | `settings.py:195-283`, `TestPrivacy` |
| Health + model warmup | ✅ Implemented | `main.py:31-38,62-83` |
| Offline banner | 🟡 Partial | `OfflineBanner.tsx:21`; wrong port text `:52` |
| Single-process SPA serving | ✅ Implemented | `main.py:97-123`, `TestSinglePipelineServing` |
| Backend test suite | ✅ Implemented | `tests/` (104 tests) |
| Frontend unit tests | ❌ Missing | no test runner in `package.json` |
| E2E tests | ✅ Implemented | `e2e/routes.mjs`, `flows.mjs`, `handsfree.mjs` |
| Evaluation suite | 🟡 Partial | scripts exist; face / voice / STT results empty |
| Wake word | ❌ Missing | grep `wake.?word` found nothing |
| Offline LLM (Ollama) | ❌ Missing | grep `ollama` found nothing |
| Emoji / sticker suggestions | ❌ Missing | grep `sticker` found nothing |
| Mood-driven desktop actions | ❌ Missing | not in `action_service.py` |
| IP webcam | ❌ Missing | grep `ip.?webcam` found nothing |
| Docker deployment | 🟡 Partial | `Dockerfile` lacks ffmpeg and OpenGL libraries |
| Windows setup | 🟡 Partial | `requirements-windows.txt` missing 8 imports; Streamlit instructions |
| Background scheduler | ✅ Implemented (by design: client polling) | `reminder_service.py:7`; only warmup threads `main.py:35-36` |

**Totals:** 42 ✅ · 17 🟡 · 11 ❌ → (42 + 0.5 × 17) / 70 ≈ **72%**.

---

## 14. Future Enhancements

These come only from the gaps found above, most important first.

1. **Security first**
   - Refuse to start with the default `SECRET_KEY`.
   - Bind to `127.0.0.1` by default.
   - Default `allow_code` to off, or sandbox `run_python`.
   - Require authentication (or a local-only check) on `/stt`, `/tts`, `/face/track`.
   - Close `/register` after the first user, or require an invite.
2. **Fix broken flows**
   - Reminders UI ↔ API contract (`scheduled_at`, `is_completed`, PATCH body).
   - `open_url` (pass the string, not `Path`).
   - `create_file` must not overwrite existing files.
   - Login failure path (remove `phase` from the effect deps).
   - Camera preview `srcObject` swap.
   - Shared STT temp files.
3. **Sessions:** check the `sessions` table in `get_current_user`, add `POST /api/logout`, and scope provider keys per user or to admins.
4. **Face liveness:** DeepFace `anti_spoofing=True`, and stop returning distance/threshold in errors.
5. **Data correctness:**
   - Real dates on the Mood x-axis.
   - Distinct avg vs common emotion.
   - Log ambient scans less often or separately.
   - Honour `language` in Profile.
   - Give nudges a `scheduled_at`.
6. **Chat history endpoint** plus reload in the UI; send location on all chat turns.
7. **Reminders:** delete / edit endpoints, date-time picker, repeat UI, presets UI. Move `useDueReminders` into `AppShell` so alerts fire on every page.
8. **Performance:**
   - In-browser face detection instead of 7 req/s uploads.
   - Warm DeepFace.
   - Lock STT model loading.
   - SQL aggregation for analytics.
   - Reuse mic stream / AudioContext.
   - Compress avatar GLBs.
9. **Audio-driven lip-sync** (analyser on the TTS `<audio>` element) instead of random amplitudes.
10. **Housekeeping:**
    - Delete dead code: `rabbitScene.ts`, `PlaceholderPage.tsx`, `useMediaRecorder.ts`, `patch.cjs`, `.streamlit/`, unused camera and session helpers.
    - Remove `requests`.
    - Add `sounddevice` for the eval script.
    - Fix `requirements-windows.txt`, the setup scripts and the Dockerfile (ffmpeg, libgl).
    - Update or archive the Streamlit-era docs and the README test count.
    - Remove the committed JWT from `e2e/routes.mjs`.
11. **Roadmap items from the docs** (still missing): wake word, offline LLM/STT, service-worker push, mood-driven actions.
