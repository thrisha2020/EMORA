# EMORA AI — Command Center UI Build Plan

**Project:** Emotion-Aware Intelligent Virtual Assistant
**Reference inspiration:** JARVIS / FALCON-style futuristic AI command center (visual language only — no branding copied)

---

## 1. Final Architecture

```
Streamlit (frontend/app.py = command center host)
   ├─ HUD chrome (persistent): top header · sidebar nav · event feed · bottom terminal
   ├─ Center: AI Core (CCv2 animated orb, emotion-reactive)
   ├─ Right: Conversation panel (user/AI + per-message emotion breakdown)
   ├─ Views: Dashboard · AI Chat · Mood · Reminders · Analytics · Profile
   └─ Service layer (frontend/api.py) — one call-site per feature, swaps mock → real
FastAPI backend — existing routers + JWT dependency + Phase-3 endpoints
DeepFace / Whisper / librosa+MLP / Groq / SQLite
```

### Data flow (real, once wired)
```
Streamlit → FastAPI → Face Service / DeepFace
                    → Whisper STT
                    → Emotion Service (face + voice + text) → Fusion
                    → Groq LLM → Response + UI
```

---

## 2. Key Decisions (locked)

1. **Single-page command center** — header/sidebar/terminal persist across views (matches the reference video).
2. **Pre-auth screens** — Login/Register are full-screen with real face capture; land on Dashboard after auth.
3. **Build order** — M1+M2 (UI shell + animated orb, mock data) → M3 (JWT) → M4+M5 (real wiring).
4. **JWT auth** — implemented in M3, replaces the UUID session token as the auth mechanism. `sessions` table kept for audit/logout.
5. **No fake functionality** where a backend integration is expected — `frontend/api.py` is the clean service interface; mock is gated by a single `USE_MOCK` flag and swapped for real HTTP calls.
6. **Streamlit rules followed** — CCv2 only for the orb (`st.components.v2.component`, never v1), no `use_container_width` (use `width="stretch"`), theming via `config.toml`, session state for chat/terminal/events, Material Symbol icons, live clock via `st.html(unsafe_allow_javascript=True)`.

---

## 3. Milestones & File Map

### M1 — Theme + HUD Shell (mock)
| File | Purpose |
|---|---|
| `.streamlit/config.toml` | Dark sci-fi theme: `#05070a` bg, cyan `#00d4ff` primary, Orbitron + JetBrains Mono fonts |
| `frontend/theme.css` | Glassmorphism panels, neon glow, thin borders, scanlines, custom buttons/scrollbars |
| `frontend/hud.py` | `render_header()` (EMORA AI · SYSTEM ONLINE · user · emotion · clock · API status), `render_sidebar()` (nav w/ neon icons), `render_terminal()`, `render_event_feed()` |
| `frontend/api.py` | Service layer, `USE_MOCK=True`; functions: `register`, `login`, `stt`, `analyze`, `chat`, `mood_history`, `reminders`, `profile` |
| `frontend/views/dashboard.py` | Default view: orb + system info + event feed (mock) |
| `frontend/app.py` (rewire) | Pre-auth (Login/Register) vs HUD host + in-app view router |

### M2 — Animated AI Core (CCv2)
| File | Purpose |
|---|---|
| `frontend/components/ai_core.py` | CCv2 inline component: canvas particle reactor, orbiting elliptical rings, pulse, state labels (ONLINE/LISTENING/THINKING/RESPONDING), equalizer bars; reads `{emotion, state, confidence}` from `data`; emotion-reactive colors/speeds |

Emotion map: happy=gold/fast · sad=blue/slow · angry=red/fast-pulse · neutral=cyan/normal.

### M3 — JWT Auth Upgrade
| File | Purpose |
|---|---|
| `backend/app/services/jwt_service.py` | HS256 `create_token`/`decode_token`, 7-day expiry, secret from `.env` |
| `backend/app/dependencies.py` | `get_current_user(HTTPBearer, db)` for protected routes |
| `backend/app/routers/auth.py` | Return JWT (keep `sessions` row for audit) |
| `backend/app/routers/chat.py` / `emotion.py` | Accept `Authorization: Bearer` |
| `backend/app/routers/reminders.py` | `POST/GET /reminders`, `PATCH /reminders/{id}/complete` |
| `backend/app/routers/analytics.py` | `GET /mood/history`, `GET /analytics`, `GET /profile` |
| `backend/app/main.py` | Mount new routers |
| `requirements.txt` | Add `PyJWT` |

### M4 — Conversation Panel (real APIs)
| File | Purpose |
|---|---|
| `frontend/views/chat.py` (refactor from pages/chat.py) | Scrollable chat panel; per-message emotion line (Face/Voice/Text/Final + confidence) + timestamps; `st.chat_input` + `st.audio_input`; real event feed + terminal events |

### M5 — Mood / Reminders / Analytics / Profile (real)
| File | Purpose |
|---|---|
| `frontend/views/mood.py` | Trends via `GET /mood/history` |
| `frontend/views/reminders.py` | CRUD via reminders router |
| `frontend/views/analytics.py` | Chat count, common emotion, sessions |
| `frontend/views/profile.py` | User profile + emotion stats |

---

## 4. View Router (sidebar nav)

```
Dashboard · AI Chat · Mood & Emotion · Reminders · Analytics · Profile · Settings · Logout
```
- `st.session_state.view` holds the active view; sidebar buttons switch it.
- Header/terminal/event feed persist across view changes.

---

## 5. HUD State (st.session_state)

- `token`, `user_name`, `user_id` — auth
- `view` — active panel
- `last_emotion`, `last_confidence` — feeds the orb
- `events` — live event feed list
- `terminal` — system-log lines
- `messages` — conversation history
- `camera_source`, `ip_webcam_url`, `_ip_capture`, `_builtin_capture`, `_capture_version` — capture flow

---

## 6. Verification Checklist

- [ ] `streamlit run frontend/app.py` boots → dark HUD visible
- [ ] Orb animates and reacts to `last_emotion` (mock)
- [ ] Sidebar navigation switches views without breaking header/terminal
- [ ] `POST /register`, `/login` return JWT (after M3)
- [ ] Protected endpoints reject invalid/expired JWT (after M3)
- [ ] Chat panel shows per-message emotion breakdown with confidence (after M4)
- [ ] Mood/Reminders/Analytics/Profile show real data (after M5)

---

## 7. Student Guide Notes

- Do not claim accuracy numbers until Phase 4A benchmarks (face emotion is a pretrained model ~60–70%; voice emotion is still a placeholder until a real SER model is trained).
- Demo order for review: Login (face) → Dashboard (orb reacts) → Chat (speak + emotion breakdown) → Mood/Reminders.
- Voice emotion currently returns neutral (untrained MLP) — text sentiment + face carry fusion until the SER model is added.
