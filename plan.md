# Project Plan — Emotion-Aware Intelligent Virtual Assistant

Team: Prajwal K H (4PM23CS076), Priya R G (4PM23CS080), Thrisha A P (4PM23CS115), Sachin M (4PM24CS408)
Guide: Ms. Vinutha H M

Today: Jul 29, 2026

## Milestones
| Date | Milestone |
|---|---|
| Aug 3, 2026 | Progress Report Submission |
| Aug 10–14, 2026 | Review 1 |
| Oct 12–16, 2026 | Review 2 & Draft Report |
| Nov 9, 2026 | Project Exhibition |

---

## Sprint 0 — Jul 29 to Aug 3 (Progress Report)
Goal: nothing needs to work yet, but the plan and skeleton must be solid.
- [ ] Finalize tech stack (Streamlit + FastAPI + DeepFace + Whisper + Gemini API + SQLite)
- [ ] Create GitHub repo, folder structure
- [ ] Draw DB schema: `users`, `sessions`, `emotion_logs`, `interactions`, `reminders`
- [ ] Write Progress Report doc: objectives, tech stack justification, timeline, task split

## Sprint 1 — Aug 4 to Aug 9 (prep for Review 1)
Goal: working login + voice-to-text demo
- [ ] Webcam capture + DeepFace face enrollment/login flow
- [ ] SQLite tables live, basic FastAPI endpoints (`/register`, `/login`)
- [ ] Whisper integration for speech-to-text
- [ ] Minimal Streamlit UI: login screen → chat screen
- [ ] Basic chatbot: Gemini API call, plain text in/out, no emotion yet

## Review 1 — Aug 10–14
Deliverable: face-recognition login + voice command → text → basic chatbot reply, live demo + slides.

## Sprint 2 — Aug 17 to Sep 15 (Emotion detection)
- [ ] Facial emotion detection (DeepFace emotion model) on webcam frames
- [ ] Voice emotion detection (Librosa/openSMILE features + classifier, or pretrained SER model)
- [ ] Combine face+voice emotion → single emotion label per turn
- [ ] Feed emotion label into chatbot prompt so replies adapt tone

## Sprint 3 — Sep 16 to Oct 5 (Personalization + reminders)
- [ ] `interactions` table: log every exchange (text, emotion, timestamp)
- [ ] Reminder module: calendar-style reminders + mood-triggered nudges
- [ ] Basic behavioral tracking: rolling mood trend per user, surfaced back into chatbot context

## Sprint 4 — Oct 6 to Oct 11 (buffer + polish for Review 2)
- [ ] Bug fixes, integration testing across all modules
- [ ] Draft report writing (methodology, results, screenshots, accuracy numbers)
- [ ] Rehearse demo

## Review 2 — Oct 12–16
Deliverable: full pipeline working end-to-end + draft report.

## Sprint 5 — Oct 19 to Nov 6 (Final polish)
- [ ] UI cleanup in Streamlit (or React frontend if time allows)
- [ ] Accuracy tuning: face recognition under different lighting, STT accuracy check, emotion classification confusion matrix
- [ ] Precision/recall/F1 tables for each module (per synopsis section 5.5)
- [ ] Final report + PPT + poster for exhibition

## Exhibition — Nov 9
Final demo, poster, PPT ready.

---

## Stretch Goal — JARVIS-style Local Automation Layer
Inspired by hobbyist builds like "Falcon" / OpenJarvis (Utkarsh Rishi's local AI desktop assistant demo). Adds voice-command system control on top of our emotion-aware core, if time allows after Review 2.
- [ ] **Assistant page (Streamlit, dark HUD)** — mic → STT → `/api/assistant` → executes OS action + speaks reply via TTS, with event/console log
- [ ] **Function-calling agent** — `POST /api/assistant` uses LLM tool-calling (Groq) so the model decides when to execute an OS action vs just reply
- [ ] **Action service (whitelisted, safe)** — create/open folders, open applications, open URLs / web search, system info (time, battery, disk); paths restricted to Desktop/Documents
- [ ] **TTS output** — `POST /api/tts` with `edge-tts` (`en-US-AriaNeural`, rate +20%) so the assistant speaks replies aloud
- [ ] Hinglish command support (Hindi+English mixed)
- [ ] Voice-command app launcher (open media player, IDE, browser, etc. via spoken command)
- [ ] Local-first/offline mode toggle — run STT + LLM inference locally (e.g. Whisper.cpp + local LLM via Ollama) instead of cloud API, for demo-without-internet resilience
- [ ] Basic workflow automation (e.g. "open VS Code and pull latest repo", "summarize this file")
- [ ] Lightweight coding-assistance mode (read a file, explain/suggest fix) as a chatbot skill
- [ ] Optional: RGB/desk-setup style demo presentation for exhibition — screen recording + voice-command showcase reel similar to the reference short

Note: this is additive polish for the exhibition demo's "wow factor," not a core deliverable — don't let it eat into Sprint 2/3 core emotion + personalization work.

## Open Decisions
- [ ] Module ownership across 4 members (by module / by layer / pairs)
- [ ] DB schema finalization
- [ ] Whether frontend stays Streamlit or moves to React for final polish
