# Progress Report — Emotion-Aware Intelligent Virtual Assistant

**Date**: Aug 3, 2026
**Team**: Prajwal K H (4PM23CS076), Priya R G (4PM23CS080), Thrisha A P (4PM23CS115), Sachin M (4PM24CS408)
**Guide**: Ms. Vinutha H M, Dept. of CSE, PESITM

## 1. Objective
Build an intelligent virtual assistant that:
- Authenticates users via face recognition (DeepFace)
- Accepts voice input via speech-to-text (Whisper)
- Detects user emotion from face (DeepFace) and voice (Librosa/SER)
- Combines emotion signals for adaptive, empathetic chatbot responses (Gemini API)
- Tracks mood trends and provides personalized reminders

## 2. Tech Stack
| Component | Technology | Justification |
|---|---|---|
| Frontend | Streamlit | Fast prototyping, built-in webcam/mic support via browser APIs |
| Backend | FastAPI (Python) | Async, auto-docs, easy REST |
| Face Recognition | DeepFace + OpenCV | Wraps multiple SOTA face models, simple API |
| Speech-to-Text | OpenAI Whisper | High accuracy, multilingual, local-capable |
| Emotion (Face) | DeepFace emotion model | Pretrained, 7-class emotion output |
| Emotion (Voice) | Librosa + SER (CNN/wav2vec2) | Lightweight feature extraction, fine-tunable |
| LLM | Gemini API | Free tier available, good empathetic tone control |
| Database | SQLite (dev) → PostgreSQL (future) | Zero-config for dev, easy migration |

## 3. Project Structure
```
emotion-assistant/
├── frontend/           # Streamlit app (login, chat UI, dashboard)
├── backend/
│   ├── app/            # FastAPI routes, main.py, DB models
│   └── models/         # Saved/trained ML models, weights
├── data/
│   ├── raw/            # Captured face images, voice samples (gitignored)
│   └── processed/       # Cleaned/preprocessed datasets (gitignored)
├── docs/               # Reports, task split, meeting notes
├── tests/              # Unit tests
├── docker-compose.yml  # One-command dev setup
├── requirements.txt
└── README.md
```

## 4. Database Schema
Tables: `users`, `sessions`, `emotion_logs`, `interactions`, `reminders`.
- **users**: id, name, face_embedding (stored as text), created_at
- **sessions**: id, user_id, token, is_active, created_at, expires_at
- **emotion_logs**: id, user_id, source (face/voice), emotion, confidence, created_at
- **interactions**: id, user_id, session_id, query_text, response_text, emotion_label, emotion_confidence, emotion_vector (JSON), created_at
- **reminders**: id, user_id, title, description, scheduled_at, is_completed, is_mood_triggered, created_at

## 5. Timeline
| Date | Milestone |
|---|---|
| Jul 30 | Phase 0 — Skeleton & DB setup complete |
| Aug 9 | Phase 1 — Face login + STT + basic chatbot |
| Aug 10–14 | Review 1 |
| Sep 15 | Phase 2 — Emotion detection & fusion |
| Oct 5 | Phase 3 — Personalization & reminders |
| Oct 11 | Phase 4A — Integration testing |
| Oct 12–16 | Review 2 |
| Nov 6 | Phase 4B — Final polish |
| Nov 9 | Exhibition |

## 6. Task Split
| Module | Owner |
|---|---|
| Face Enrollment & Login | Prajwal K H |
| Speech-to-Text | Thrisha A P |
| Chatbot (Gemini) | Sachin M |
| Emotion Detection (Face + Voice) | _Phase 2_ |
| Emotion Fusion | _Phase 2_ |
| Personalization & Reminders | _Phase 3_ |
| Streamlit UI | Priya R G (coordinator) |
| Reports & Documentation | All |

## 7. Current Status (Jul 29)
- [x] GitHub repo created
- [x] Folder structure established
- [x] DB schema designed, SQLAlchemy models written
- [x] FastAPI scaffold with placeholder routes
- [x] Streamlit scaffold with multi-page navigation
- [x] Docker Compose for one-command dev
- [x] Team roles assigned
- [ ] `.env` configured with Gemini API key
- [ ] Phase 1 implementation started

## 8. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Face recognition fails in poor lighting | Test under varied conditions; allow text-password fallback |
| Whisper too slow on CPU | Use `tiny` model for dev, `base` for demo |
| SER model accuracy low | Use text sentiment as fallback; fuse with face emotion |
| Gemini API rate limits | Cache responses; queue requests |
