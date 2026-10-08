"""API-level tests against an isolated in-memory database."""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models import EmotionLog, ProviderKey, User
from backend.app.services.crypto_service import decrypt, encrypt, mask
from backend.app.services.jwt_service import create_token


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def user(db_session):
    u = User(name="Akash", face_embedding="[0.1, 0.2]")
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture()
def auth(user):
    return {"Authorization": f"Bearer {create_token(user.id)}"}


class TestHealth:
    def test_health_needs_no_auth(self, client):
        body = client.get("/api/health").json()
        assert body["status"] == "ok"

    def test_health_reports_model_readiness(self, client):
        """The UI uses this to say "warming up" instead of appearing to hang."""
        body = client.get("/api/health").json()
        assert set(body["models"]) >= {"stt", "voice", "text"}
        assert isinstance(body["ready"], bool)

    def test_not_ready_until_every_model_settles(self, client, monkeypatch):
        from backend.app.services import emotion_service, stt_service

        monkeypatch.setattr(
            emotion_service,
            "readiness",
            lambda: {"text": True, "voice": False, "text_fallback": False, "voice_fallback": False},
        )
        monkeypatch.setattr(stt_service, "is_ready", lambda: True)
        assert client.get("/api/health").json()["ready"] is False

    def test_a_failed_model_still_counts_as_settled(self, client, monkeypatch):
        """A model that failed to load has a live fallback — don't block on it."""
        from backend.app.services import emotion_service, stt_service

        monkeypatch.setattr(
            emotion_service,
            "readiness",
            lambda: {"text": True, "voice": False, "text_fallback": False, "voice_fallback": True},
        )
        monkeypatch.setattr(stt_service, "is_ready", lambda: True)
        assert client.get("/api/health").json()["ready"] is True


class TestIdentify:
    def test_known_name(self, client, user):
        r = client.post("/api/auth/identify", json={"name": "Akash"})
        assert r.status_code == 200
        assert r.json()["known"] is True

    def test_name_match_is_case_insensitive(self, client, user):
        assert client.post("/api/auth/identify", json={"name": "akash"}).json()["known"] is True

    def test_unknown_name(self, client, user):
        body = client.post("/api/auth/identify", json={"name": "Nobody"}).json()
        assert body["known"] is False
        assert body["enrolled_count"] == 1

    def test_short_name_rejected(self, client):
        assert client.post("/api/auth/identify", json={"name": "A"}).status_code == 400


class TestAuthGuards:
    @pytest.mark.parametrize(
        "method,path",
        [
            ("get", "/api/settings/providers"),
            ("get", "/api/reminders"),
            ("get", "/api/analytics"),
            ("post", "/api/chat"),
        ],
    )
    def test_protected_endpoints_reject_anonymous(self, client, method, path):
        r = getattr(client, method)(path, **({"json": {"message": "hi"}} if method == "post" else {}))
        assert r.status_code in (401, 403)

    def test_invalid_token_rejected(self, client):
        r = client.get("/api/settings/providers", headers={"Authorization": "Bearer nope"})
        assert r.status_code in (401, 403)


class TestProviderKeys:
    SECRET = "sk-ant-api03-secret-value-9f2a"

    def test_catalog_lists_all_providers(self, client, auth):
        ids = {p["id"] for p in client.get("/api/settings/providers", headers=auth).json()["providers"]}
        assert ids == {"openai", "anthropic", "groq", "xai", "nvidia"}

    def test_key_is_encrypted_at_rest(self, client, auth, db_session):
        client.put(
            "/api/settings/providers",
            headers=auth,
            json={"provider": "anthropic", "api_key": self.SECRET, "model": "claude-opus-5"},
        )
        row = db_session.query(ProviderKey).filter_by(provider="anthropic").one()
        assert self.SECRET not in row.api_key
        assert decrypt(row.api_key) == self.SECRET

    def test_plaintext_key_never_returned(self, client, auth):
        client.put(
            "/api/settings/providers",
            headers=auth,
            json={"provider": "openai", "api_key": self.SECRET},
        )
        body = client.get("/api/settings/providers", headers=auth).text
        assert self.SECRET not in body
        entry = next(
            p for p in client.get("/api/settings/providers", headers=auth).json()["providers"]
            if p["id"] == "openai"
        )
        assert entry["configured"] is True
        assert entry["masked_key"] == mask(self.SECRET)

    def test_activating_one_provider_deactivates_others(self, client, auth, db_session):
        for pid in ("openai", "groq"):
            client.put(
                "/api/settings/providers",
                headers=auth,
                json={"provider": pid, "api_key": f"key-for-{pid}", "activate": True},
            )
        active = db_session.query(ProviderKey).filter_by(is_active=1).all()
        assert [p.provider for p in active] == ["groq"]

    def test_model_can_change_without_resending_the_key(self, client, auth, db_session):
        client.put(
            "/api/settings/providers",
            headers=auth,
            json={"provider": "groq", "api_key": "gsk_original"},
        )
        client.put(
            "/api/settings/providers",
            headers=auth,
            json={"provider": "groq", "model": "llama-3.1-8b-instant"},
        )
        row = db_session.query(ProviderKey).filter_by(provider="groq").one()
        assert row.model == "llama-3.1-8b-instant"
        assert decrypt(row.api_key) == "gsk_original"

    def test_first_save_requires_a_key(self, client, auth):
        r = client.put("/api/settings/providers", headers=auth, json={"provider": "xai"})
        assert r.status_code == 400

    def test_unknown_provider_rejected(self, client, auth):
        r = client.put(
            "/api/settings/providers", headers=auth, json={"provider": "skynet", "api_key": "x"}
        )
        assert r.status_code == 400

    def test_delete_removes_the_key(self, client, auth, db_session):
        client.put(
            "/api/settings/providers", headers=auth, json={"provider": "nvidia", "api_key": "nvapi-x"}
        )
        assert client.delete("/api/settings/providers/nvidia", headers=auth).status_code == 200
        assert db_session.query(ProviderKey).filter_by(provider="nvidia").first() is None


class TestCrypto:
    def test_round_trip(self):
        assert decrypt(encrypt("hello-secret")) == "hello-secret"

    def test_ciphertext_differs_each_time(self):
        assert encrypt("same") != encrypt("same")

    def test_corrupt_token_returns_none_instead_of_raising(self):
        assert decrypt("not-a-fernet-token") is None

    def test_mask_hides_the_middle(self):
        masked = mask("sk-ant-api03-abcdefghijklmnop")
        assert masked.startswith("sk-ant")
        assert masked.endswith("mnop")
        assert "abcdefghij" not in masked


class TestReminders:
    def test_create_and_list(self, client, auth):
        created = client.post("/api/reminders", headers=auth, json={"title": "Drink water"})
        assert created.status_code == 200
        listed = client.get("/api/reminders", headers=auth).json()
        assert [r["title"] for r in listed] == ["Drink water"]

    def test_blank_title_rejected(self, client, auth):
        assert client.post("/api/reminders", headers=auth, json={"title": "   "}).status_code == 400

    def test_complete_toggles_the_flag(self, client, auth):
        rid = client.post("/api/reminders", headers=auth, json={"title": "Stretch"}).json()["id"]
        done = client.patch(f"/api/reminders/{rid}/complete", headers=auth, json={"is_completed": True})
        assert done.json()["is_completed"] == 1

    def test_cannot_complete_another_users_reminder(self, client, auth, db_session):
        other = User(name="Someone Else")
        db_session.add(other)
        db_session.commit()
        rid = client.post("/api/reminders", headers=auth, json={"title": "Mine"}).json()["id"]
        headers = {"Authorization": f"Bearer {create_token(other.id)}"}
        assert client.patch(f"/api/reminders/{rid}/complete", headers=headers, json={}).status_code == 404


class TestMoodService:
    def test_nudge_fires_after_a_negative_streak(self, db_session, user):
        from backend.app.services.mood_service import maybe_create_nudge

        for _ in range(3):
            db_session.add(EmotionLog(user_id=user.id, source="fused", emotion="sad", confidence=0.8))
        db_session.commit()

        nudge = maybe_create_nudge(db_session, user.id)
        assert nudge is not None
        assert nudge.is_mood_triggered == 1

    def test_no_nudge_below_the_threshold(self, db_session, user):
        from backend.app.services.mood_service import maybe_create_nudge

        db_session.add(EmotionLog(user_id=user.id, source="fused", emotion="sad", confidence=0.8))
        db_session.commit()
        assert maybe_create_nudge(db_session, user.id) is None

    def test_positive_reading_breaks_the_streak(self, db_session, user):
        from backend.app.services.mood_service import maybe_create_nudge

        for emotion in ("sad", "sad", "sad", "happy"):
            db_session.add(
                EmotionLog(user_id=user.id, source="fused", emotion=emotion, confidence=0.8)
            )
            db_session.commit()
        assert maybe_create_nudge(db_session, user.id) is None

    def test_cooldown_prevents_duplicate_nudges(self, db_session, user):
        from backend.app.services.mood_service import maybe_create_nudge

        for _ in range(4):
            db_session.add(EmotionLog(user_id=user.id, source="fused", emotion="sad", confidence=0.8))
        db_session.commit()

        assert maybe_create_nudge(db_session, user.id) is not None
        assert maybe_create_nudge(db_session, user.id) is None  # within cooldown

    def test_trend_summary_needs_enough_data(self, db_session, user):
        from backend.app.services.mood_service import trend_summary

        assert trend_summary(db_session, user.id) is None
        for _ in range(5):
            db_session.add(EmotionLog(user_id=user.id, source="fused", emotion="happy", confidence=0.9))
        db_session.commit()
        assert "happy" in trend_summary(db_session, user.id)


class TestLLMResolution:
    def test_missing_provider_raises_a_helpful_error(self, db_session, monkeypatch):
        from backend.app.services import llm_service

        monkeypatch.setattr(llm_service, "LLM_API_KEY", "")
        with pytest.raises(llm_service.LLMError, match="Settings"):
            llm_service.resolve(db_session)

    def test_active_db_row_wins_over_env(self, db_session, monkeypatch):
        from backend.app.services import llm_service

        monkeypatch.setattr(llm_service, "LLM_API_KEY", "env-key")
        db_session.add(
            ProviderKey(
                provider="anthropic",
                api_key=encrypt("db-key"),
                model="claude-opus-5",
                is_active=1,
            )
        )
        db_session.commit()

        resolved = llm_service.resolve(db_session)
        assert resolved.api_key == "db-key"
        assert resolved.provider.transport == "anthropic"

    def test_env_used_when_no_row_is_active(self, db_session, monkeypatch):
        from backend.app.services import llm_service

        monkeypatch.setattr(llm_service, "LLM_API_KEY", "env-key")
        assert llm_service.resolve(db_session).api_key == "env-key"

    def test_tool_schema_translation(self):
        from backend.app.services.chat_service import TOOLS
        from backend.app.services.llm_service import _to_anthropic_tools, _to_openai_tools

        anthropic_tools = _to_anthropic_tools(TOOLS)
        assert all("input_schema" in t for t in anthropic_tools)
        assert "parameters" not in anthropic_tools[0]

        openai_tools = _to_openai_tools(TOOLS)
        assert all(t["type"] == "function" for t in openai_tools)
        assert "parameters" in openai_tools[0]["function"]


class TestWarmupToggle:
    """EMORA_WARMUP=0 trades a slow first turn for ~2-3 GB of unpinned memory."""

    def test_health_reports_the_warmup_setting(self, client):
        assert "warmup" in client.get("/api/health").json()

    def test_disabled_warmup_still_reports_ready(self, client, monkeypatch):
        """Nothing preloads, so gating the UI on readiness would kill voice entirely."""
        import backend.app.main as main
        from backend.app.services import emotion_service, stt_service

        monkeypatch.setattr(main, "WARMUP_MODELS", False, raising=False)
        monkeypatch.setattr(
            "backend.app.config.WARMUP_MODELS", False, raising=False
        )
        monkeypatch.setattr(
            emotion_service,
            "readiness",
            lambda: {"text": False, "voice": False, "text_fallback": False, "voice_fallback": False},
        )
        monkeypatch.setattr(stt_service, "is_ready", lambda: False)
        body = client.get("/api/health").json()
        assert body["warmup"] is False
        assert body["ready"] is True


def _synthetic_face(shift_x: int = 0, width: int = 480, height: int = 360) -> bytes:
    """A crude but cascade-detectable face, offset horizontally by `shift_x`."""
    import cv2
    import numpy as np

    img = np.full((height, width, 3), 30, np.uint8)
    cx, cy = width // 2 + shift_x, height // 2
    cv2.ellipse(img, (cx, cy), (58, 76), 0, 0, 360, (205, 195, 185), -1)
    cv2.ellipse(img, (cx - 22, cy - 18), (11, 7), 0, 0, 360, (35, 30, 28), -1)
    cv2.ellipse(img, (cx + 22, cy - 18), (11, 7), 0, 0, 360, (35, 30, 28), -1)
    cv2.ellipse(img, (cx, cy + 34), (24, 9), 0, 0, 360, (60, 45, 45), -1)
    return cv2.imencode(".jpg", img)[1].tobytes()


class TestFaceTracking:
    """Drives the avatar's gaze — must stay fast and unauthenticated."""

    def test_no_auth_required(self, client):
        """It is polled several times a second; an auth round-trip would be waste."""
        r = client.post(
            "/api/face/track", files={"file": ("f.jpg", _synthetic_face(), "image/jpeg")}
        )
        assert r.status_code == 200

    def test_centred_face_reports_centre(self, client):
        body = client.post(
            "/api/face/track", files={"file": ("f.jpg", _synthetic_face(0), "image/jpeg")}
        ).json()
        assert body["found"] is True
        assert abs(body["x"]) < 0.15

    def test_offset_face_reports_matching_side(self, client):
        left = client.post(
            "/api/face/track", files={"file": ("f.jpg", _synthetic_face(-110), "image/jpeg")}
        ).json()
        right = client.post(
            "/api/face/track", files={"file": ("f.jpg", _synthetic_face(110), "image/jpeg")}
        ).json()
        assert left["found"] and right["found"]
        # x is in image space: negative on the left of frame, positive on the right.
        assert left["x"] < -0.2
        assert right["x"] > 0.2

    def test_coordinates_stay_normalised(self, client):
        body = client.post(
            "/api/face/track", files={"file": ("f.jpg", _synthetic_face(220), "image/jpeg")}
        ).json()
        if body["found"]:
            assert -1.0 <= body["x"] <= 1.0
            assert -1.0 <= body["y"] <= 1.0
            assert 0.0 < body["scale"] <= 1.0

    def test_blank_frame_reports_not_found(self, client):
        import cv2
        import numpy as np

        blank = cv2.imencode(".jpg", np.full((360, 480, 3), 20, np.uint8))[1].tobytes()
        body = client.post(
            "/api/face/track", files={"file": ("f.jpg", blank, "image/jpeg")}
        ).json()
        assert body["found"] is False

    def test_empty_upload_rejected(self, client):
        r = client.post("/api/face/track", files={"file": ("f.jpg", b"", "image/jpeg")})
        assert r.status_code == 400


class TestVisionChat:
    """Camera questions: 'how many fingers', gestures, objects held up."""

    @staticmethod
    def _jpeg() -> bytes:
        import cv2
        import numpy as np

        return cv2.imencode(".jpg", np.full((120, 160, 3), 128, np.uint8))[1].tobytes()

    def test_vision_endpoint_requires_auth(self, client):
        r = client.post("/api/chat/vision", data={"message": "how many fingers?"})
        assert r.status_code in (401, 403)

    def test_rejects_oversized_image(self, client, auth):
        from backend.app.routers.chat import MAX_IMAGE_BYTES

        big = b"\xff" * (MAX_IMAGE_BYTES + 1)
        r = client.post(
            "/api/chat/vision",
            headers=auth,
            data={"message": "what is this"},
            files={"image": ("f.jpg", big, "image/jpeg")},
        )
        assert r.status_code == 413

    def test_text_only_model_reports_clearly(self, client, auth, db_session):
        """A vision question on a text-only model must explain, not fail obscurely."""
        db_session.add(
            ProviderKey(
                provider="groq",
                api_key=encrypt("gsk_test"),
                model="llama-3.3-70b-versatile",  # no vision
                is_active=1,
            )
        )
        db_session.commit()
        r = client.post(
            "/api/chat/vision",
            headers=auth,
            data={"message": "how many fingers am I holding up?"},
            files={"image": ("f.jpg", self._jpeg(), "image/jpeg")},
        )
        assert r.status_code == 400
        assert "vision" in r.json()["detail"].lower()

    def test_prompt_tells_the_model_it_can_see(self):
        from backend.app.services.chat_service import build_system_prompt

        seeing = build_system_prompt(1, "Akash", seeing=True)
        blind = build_system_prompt(1, "Akash", seeing=False)
        assert "webcam frame is attached" in seeing
        assert "webcam frame is attached" not in blind

    def test_location_reaches_the_prompt_only_when_given(self):
        from backend.app.services.chat_service import build_system_prompt

        with_loc = build_system_prompt(1, "Akash", location="Shivamogga, Karnataka, India")
        without = build_system_prompt(1, "Akash")
        assert "Shivamogga" in with_loc
        assert "location" not in without.lower()


class TestVisionCapability:
    def test_known_vision_models(self):
        from backend.app.services.providers import supports_vision

        assert supports_vision("anthropic", "claude-opus-5")
        assert supports_vision("openai", "gpt-4o")

    def test_dated_snapshots_still_match(self):
        """Providers append dates to model ids; prefix matching must survive that."""
        from backend.app.services.providers import supports_vision

        assert supports_vision("openai", "gpt-4o-2024-08-06")

    def test_text_only_models_are_not_claimed_as_vision(self):
        from backend.app.services.providers import supports_vision

        assert not supports_vision("groq", "llama-3.3-70b-versatile")
        assert not supports_vision("nvidia", "nvidia/llama-3.3-nemotron-super-49b-v1")

    def test_unknown_provider_is_not_vision(self):
        from backend.app.services.providers import supports_vision

        assert not supports_vision("skynet", "anything")


class TestReasoningStripping:
    """Reasoning models emit <think> blocks in the content field.

    Left in place they are displayed in the chat *and* read aloud by TTS, so
    they have to be removed before the reply leaves the service.
    """

    def test_removes_closed_block(self):
        from backend.app.services.llm_service import strip_reasoning

        assert strip_reasoning("<think>counting…</think>Three fingers.") == "Three fingers."

    def test_removes_block_truncated_by_max_tokens(self):
        from backend.app.services.llm_service import strip_reasoning

        assert strip_reasoning("<think>ran out of budget mid-thought") == ""

    def test_is_case_insensitive(self):
        from backend.app.services.llm_service import strip_reasoning

        assert strip_reasoning("<THINK>x</THINK>Hi") == "Hi"

    def test_leaves_ordinary_replies_untouched(self):
        from backend.app.services.llm_service import strip_reasoning

        assert strip_reasoning("Just a normal answer.") == "Just a normal answer."

    def test_handles_none_and_empty(self):
        from backend.app.services.llm_service import strip_reasoning

        assert strip_reasoning("") == ""
        assert strip_reasoning(None) == ""

    def test_keeps_text_around_the_block(self):
        from backend.app.services.llm_service import strip_reasoning

        assert strip_reasoning("Before <think>mid</think> after") == "Before  after".strip()


class TestReminderDelivery:
    """`scheduled_at` used to be stored and never read — nothing ever fired."""

    def _make(self, db_session, user, **kw):
        import datetime

        from backend.app.models import Reminder

        defaults = dict(
            user_id=user.id,
            title="Drink water",
            scheduled_at=datetime.datetime.utcnow() - datetime.timedelta(minutes=1),
        )
        defaults.update(kw)
        r = Reminder(**defaults)
        db_session.add(r)
        db_session.commit()
        db_session.refresh(r)
        return r

    def test_past_due_reminder_is_returned(self, client, auth, db_session, user):
        self._make(db_session, user)
        due = client.get("/api/reminders/due", headers=auth).json()
        assert [d["title"] for d in due] == ["Drink water"]

    def test_future_reminder_is_not_returned(self, client, auth, db_session, user):
        import datetime

        self._make(
            db_session,
            user,
            scheduled_at=datetime.datetime.utcnow() + datetime.timedelta(hours=1),
        )
        assert client.get("/api/reminders/due", headers=auth).json() == []

    def test_reminder_without_a_time_never_fires(self, client, auth, db_session, user):
        self._make(db_session, user, scheduled_at=None)
        assert client.get("/api/reminders/due", headers=auth).json() == []

    def test_completed_reminder_does_not_fire(self, client, auth, db_session, user):
        self._make(db_session, user, is_completed=1)
        assert client.get("/api/reminders/due", headers=auth).json() == []

    def test_one_off_fires_exactly_once(self, client, auth, db_session, user):
        self._make(db_session, user)
        first = client.get("/api/reminders/due", headers=auth).json()
        second = client.get("/api/reminders/due", headers=auth).json()
        assert len(first) == 1
        assert second == []

    def test_recurring_reminder_rolls_forward(self, client, auth, db_session, user):
        import datetime

        self._make(db_session, user, repeat="hourly", title="Water")
        due = client.get("/api/reminders/due", headers=auth).json()
        assert len(due) == 1
        # Fired, and rescheduled into the future rather than retired.
        assert client.get("/api/reminders/due", headers=auth).json() == []
        listed = client.get("/api/reminders", headers=auth).json()
        nxt = datetime.datetime.fromisoformat(listed[0]["scheduled_at"])
        assert nxt > datetime.datetime.utcnow()

    def test_long_missed_one_off_is_retired_not_announced(self, client, auth, db_session, user):
        import datetime

        self._make(
            db_session,
            user,
            scheduled_at=datetime.datetime.utcnow() - datetime.timedelta(days=2),
        )
        # Two days late is noise, not help.
        assert client.get("/api/reminders/due", headers=auth).json() == []

    def test_long_missed_recurring_catches_up(self, client, auth, db_session, user):
        import datetime

        self._make(
            db_session,
            user,
            repeat="daily",
            scheduled_at=datetime.datetime.utcnow() - datetime.timedelta(days=3),
        )
        client.get("/api/reminders/due", headers=auth)
        listed = client.get("/api/reminders", headers=auth).json()
        nxt = datetime.datetime.fromisoformat(listed[0]["scheduled_at"])
        assert nxt > datetime.datetime.utcnow()

    def test_users_only_see_their_own(self, client, auth, db_session, user):
        from backend.app.models import User

        other = User(name="Someone Else")
        db_session.add(other)
        db_session.commit()
        self._make(db_session, other)
        assert client.get("/api/reminders/due", headers=auth).json() == []

    def test_water_intake_preset_exists(self, client, auth):
        """Named explicitly in the synopsis as the activity-pattern example."""
        presets = client.get("/api/reminders/presets", headers=auth).json()["presets"]
        ids = {p["id"] for p in presets}
        assert "water" in ids
        water = next(p for p in presets if p["id"] == "water")
        assert water["repeat"] == "hourly"

    def test_creating_a_preset_schedules_it(self, client, auth):
        r = client.post("/api/reminders/presets/water?first_in_minutes=0", headers=auth)
        assert r.status_code == 200
        assert r.json()["repeat"] == "hourly"

    def test_unknown_preset_rejected(self, client, auth):
        assert client.post("/api/reminders/presets/nonsense", headers=auth).status_code == 400


class TestSinglePipelineServing:
    """FastAPI serves the built frontend, so no Node process is needed.

    On a memory-constrained machine both `npm run dev` and `vite preview` were
    repeatedly OOM-killed; folding the UI into the API process removes that
    second process entirely.
    """

    def test_api_routes_still_win_over_the_spa_catch_all(self, client):
        """The catch-all is registered last; /api must never fall through to it."""
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_unknown_api_path_is_not_served_as_html(self, client):
        r = client.get("/api/definitely-not-a-route")
        assert r.status_code == 404

    @pytest.mark.skipif(
        not os.path.isdir(os.path.join("emora-frontend", "dist")),
        reason="frontend not built",
    )
    def test_deep_link_returns_the_spa_shell(self, client):
        """Client-side routes have no file behind them and must get index.html."""
        r = client.get("/chat")
        assert r.status_code == 200
        assert "<!doctype html" in r.text.lower()

    @pytest.mark.skipif(
        not os.path.isdir(os.path.join("emora-frontend", "dist")),
        reason="frontend not built",
    )
    @pytest.mark.parametrize(
        "path",
        ["/../.env", "/../../.env", "/../backend/app/config.py", "/etc/passwd"],
    )
    def test_path_traversal_cannot_escape_dist(self, client, path):
        r = client.get(path)
        # Falls back to the SPA shell rather than serving a file outside dist.
        assert "LLM_API_KEY" not in r.text
        assert "SECRET_KEY" not in r.text


@pytest.fixture()
def sandbox_files(tmp_path, monkeypatch):
    """Run from a temp dir: memories live in relative data/ paths, and the test
    user shares id 1 with a real account — never touch the real files."""
    monkeypatch.chdir(tmp_path)
    return tmp_path


class TestPreferences:
    def test_defaults(self, client, auth):
        body = client.get("/api/settings/preferences", headers=auth).json()
        assert body == {
            "allow_actions": True,
            "allow_code": True,
            "tone": "warm",
            "reply_length": "normal",
            "language": "auto",
        }

    def test_partial_update_keeps_other_fields(self, client, auth):
        client.put("/api/settings/preferences", headers=auth, json={"tone": "playful"})
        body = client.put("/api/settings/preferences", headers=auth, json={"allow_code": False}).json()
        assert body["tone"] == "playful"
        assert body["allow_code"] is False

    def test_rejects_unknown_values(self, client, auth):
        r = client.put("/api/settings/preferences", headers=auth, json={"tone": "sarcastic"})
        assert r.status_code == 422

    def test_actions_off_skips_os_actions(self, client, auth, monkeypatch):
        from backend.app.routers import chat as chat_router
        from backend.app.services import action_service

        calls = []
        monkeypatch.setattr(action_service, "handle", lambda m: calls.append(m) or "Done.")
        monkeypatch.setattr(chat_router, "get_reply", lambda *a, **k: "plain reply")

        client.put("/api/settings/preferences", headers=auth, json={"allow_actions": False})
        r = client.post("/api/chat", headers=auth, json={"message": "create folder named x on desktop"})
        assert r.json() == {**r.json(), "reply": "plain reply", "action": False}
        assert calls == []

    def test_code_off_withholds_and_refuses_run_python(self, db_session, user, monkeypatch, sandbox_files):
        from backend.app.models import UserPreference
        from backend.app.services import chat_service

        db_session.add(UserPreference(user_id=user.id, allow_code=0))
        db_session.commit()
        seen = {}

        def fake_complete(db, system, messages, tools, dispatch, image=None):
            seen["tools"] = [t["name"] for t in tools]
            seen["forced"] = dispatch("run_python", {"code": "print(1)"})
            return "ok"

        monkeypatch.setattr(chat_service, "complete", fake_complete)
        chat_service.get_reply(db_session, user.id, "hi")
        assert "run_python" not in seen["tools"]
        assert "turned off" in seen["forced"]

    def test_personality_reaches_the_prompt(self, sandbox_files):
        from backend.app.models import UserPreference
        from backend.app.services.chat_service import build_system_prompt

        prefs = UserPreference(tone="playful", reply_length="brief", language="hi")
        prompt = build_system_prompt(1, "Akash", preferences=prefs)
        assert "playful" in prompt and "one or two sentences" in prompt and "Hindi" in prompt


class TestPrivacy:
    def test_export_has_history_but_not_the_face_vector(self, client, auth, db_session, user, sandbox_files):
        from backend.app.models import Interaction

        db_session.add(Interaction(user_id=user.id, query_text="hello", response_text="hi"))
        db_session.commit()
        body = client.get("/api/settings/export", headers=auth).json()
        assert body["conversations"][0]["you"] == "hello"
        assert body["user"]["face_enrolled"] is True
        assert "0.1" not in str(body)  # the embedding itself stays out

    def test_clear_chats_only_touches_this_user(self, client, auth, db_session, user):
        from backend.app.models import Interaction

        other = User(name="Other")
        db_session.add(other)
        db_session.commit()
        db_session.add_all([
            Interaction(user_id=user.id, query_text="mine"),
            Interaction(user_id=other.id, query_text="theirs"),
        ])
        db_session.commit()
        assert client.delete("/api/settings/data/chats", headers=auth).json() == {"deleted": 1}
        assert db_session.query(Interaction).count() == 1

    def test_forget_memories_removes_the_files(self, client, auth, user, sandbox_files):
        from backend.app.services.chat_service import _save_memory

        _save_memory(user.id, "Likes tea")
        r = client.delete("/api/settings/data/memories", headers=auth)
        assert r.json() == {"deleted": 1}
        assert not (sandbox_files / "data" / "memories" / f"user_{user.id}.json").exists()

    def test_delete_account_needs_the_name(self, client, auth, db_session, user, sandbox_files):
        r = client.post("/api/settings/account/delete", headers=auth, json={"confirm_name": "nope"})
        assert r.status_code == 400
        assert db_session.get(User, user.id) is not None

    def test_delete_account_removes_everything(self, client, auth, db_session, user, sandbox_files):
        from backend.app.models import EmotionLog, UserPreference

        db_session.add_all([
            EmotionLog(user_id=user.id, source="face", emotion="happy"),
            UserPreference(user_id=user.id),
        ])
        db_session.commit()
        r = client.post("/api/settings/account/delete", headers=auth, json={"confirm_name": "akash"})
        assert r.json() == {"deleted": True}
        db_session.expire_all()
        assert db_session.query(User).count() == 0
        assert db_session.query(EmotionLog).count() == 0
        assert db_session.query(UserPreference).count() == 0
        # The old token no longer works.
        assert client.get("/api/settings/preferences", headers=auth).status_code == 401


class TestSpeech:
    def test_clean_for_speech_drops_what_would_be_read_literally(self):
        from backend.app.services.tts_service import clean_for_speech

        text = "## Plan\n- **Drink** water 💧\n- Stretch\n<b>Done</b> [see](https://x.io)"
        assert clean_for_speech(text) == "Plan. Drink water. Stretch. Done see"

    def test_hindi_text_on_an_english_voice_switches_voice(self, monkeypatch):
        import asyncio

        from backend.app.services import tts_service

        used = []

        class FakeCommunicate:
            def __init__(self, text, voice, rate):
                used.append(voice)

            async def stream(self):
                yield {"type": "audio", "data": b"mp3"}

        monkeypatch.setattr(tts_service.edge_tts, "Communicate", FakeCommunicate)
        for voice in ("en-IN-NeerjaExpressiveNeural", "en-US-AvaMultilingualNeural", "mr-IN-AarohiNeural"):
            asyncio.run(tts_service.synthesize("नमस्ते", voice=voice))
        assert used == ["hi-IN-SwaraNeural", "en-US-AvaMultilingualNeural", "mr-IN-AarohiNeural"]

    def test_hinglish_is_a_valid_language(self, client, auth):
        r = client.put("/api/settings/preferences", headers=auth, json={"language": "hinglish"})
        assert r.json()["language"] == "hinglish"


class TestLogout:
    """Sessions used to be written and never checked, so logout was local-only."""

    def test_login_token_carries_a_session_id(self, db_session, user):
        from backend.app.services.jwt_service import create_token, decode_token
        from backend.app.services.session_service import create_session

        session = create_session(db_session, user.id)
        assert decode_token(create_token(user.id, session.id))["sid"] == session.id

    def test_logout_revokes_the_token(self, client, db_session, user):
        from backend.app.models import Session as SessionModel
        from backend.app.services.jwt_service import create_token
        from backend.app.services.session_service import create_session

        session = create_session(db_session, user.id)
        auth = {"Authorization": f"Bearer {create_token(user.id, session.id)}"}
        assert client.get("/api/settings/preferences", headers=auth).status_code == 200
        assert client.post("/api/logout", headers=auth).json() == {"revoked": True}
        assert db_session.get(SessionModel, session.id).is_active == 0
        assert client.get("/api/settings/preferences", headers=auth).status_code == 401

    def test_token_without_a_session_still_works(self, client, auth):
        """Tokens minted before `sid` existed stay valid until they expire."""
        assert client.get("/api/settings/preferences", headers=auth).status_code == 200
        assert client.post("/api/logout", headers=auth).json() == {"revoked": False}


class TestRemindersContract:
    """The UI used to send {title, time} and read r.completed — neither matched."""

    def test_create_with_scheduled_at_then_complete_with_body(self, client, auth):
        import datetime

        when = (datetime.datetime.now() + datetime.timedelta(hours=1)).isoformat()
        created = client.post(
            "/api/reminders", headers=auth, json={"title": "Drink water", "scheduled_at": when, "repeat": "daily"}
        ).json()
        assert created["scheduled_at"] is not None and created["repeat"] == "daily"
        assert created["is_completed"] == 0

        done = client.patch(
            f"/api/reminders/{created['id']}/complete", headers=auth, json={"is_completed": True}
        )
        assert done.status_code == 200 and done.json()["is_completed"] == 1

    def test_complete_without_a_body_is_rejected(self, client, auth):
        """Documents why the client must send one: FastAPI requires the model."""
        import datetime

        when = (datetime.datetime.now() + datetime.timedelta(hours=1)).isoformat()
        created = client.post("/api/reminders", headers=auth, json={"title": "x", "scheduled_at": when}).json()
        assert client.patch(f"/api/reminders/{created['id']}/complete", headers=auth).status_code == 422


class TestDesktopActionSafety:
    def test_create_file_never_overwrites(self, tmp_path, monkeypatch):
        from backend.app.services import action_service

        monkeypatch.setattr(action_service, "_target_dir", lambda location: tmp_path)
        existing = tmp_path / "notes.txt"
        existing.write_text("important", encoding="utf-8")

        reply = action_service.handle("create file named notes.txt on desktop")
        assert "already exists" in reply
        assert existing.read_text(encoding="utf-8") == "important"

    def test_create_file_still_creates_a_new_one(self, tmp_path, monkeypatch):
        from backend.app.services import action_service

        monkeypatch.setattr(action_service, "_target_dir", lambda location: tmp_path)
        assert "Done" in action_service.handle("create file named fresh.txt on desktop")
        assert (tmp_path / "fresh.txt").exists()

    def test_open_url_keeps_the_double_slash(self, monkeypatch):
        """Path('https://x') collapses to 'https:/x', which no opener resolves."""
        import webbrowser

        from backend.app.services import action_service

        opened = []
        monkeypatch.setattr(webbrowser, "open", lambda url: opened.append(url) or True)
        action_service.handle("open https://example.com")
        assert opened == ["https://example.com"]


class TestSttTempFiles:
    def test_each_call_gets_its_own_files_and_cleans_up(self, monkeypatch):
        from backend.app.services import stt_service

        seen = []

        def fake_run(cmd, **kwargs):
            seen.append(cmd[3])  # the raw input path
            open(cmd[-1], "wb").write(b"RIFF")  # pretend ffmpeg wrote the wav
            return None

        monkeypatch.setattr(stt_service.subprocess, "run", fake_run)
        monkeypatch.setattr(stt_service, "_get_parakeet", lambda: type("M", (), {"transcribe": lambda self, p: "hi"})())

        for _ in range(2):
            assert stt_service.transcribe(b"x" * 200)["text"] == "hi"
        assert seen[0] != seen[1], "temp files must not be shared between requests"
        assert not any(os.path.exists(p) for p in seen), "temp files must be cleaned up"

    def test_missing_ffmpeg_raises_a_clear_error(self, monkeypatch):
        from backend.app.services import stt_service

        def boom(*a, **k):
            raise FileNotFoundError("ffmpeg")

        monkeypatch.setattr(stt_service.subprocess, "run", boom)
        with pytest.raises(RuntimeError, match="ffmpeg"):
            stt_service.transcribe(b"x" * 200)


class TestFaceLiveness:
    def test_spoofed_frame_is_rejected(self, monkeypatch):
        import numpy as np

        from backend.app.services import face_service

        class FakeDeepFace:
            @staticmethod
            def represent(**kwargs):
                assert kwargs["anti_spoofing"] is True
                raise ValueError("Spoof detected in the given image.")

        monkeypatch.setattr(face_service, "FACE_LIVENESS", True)
        monkeypatch.setattr(face_service, "_get_deepface", lambda: FakeDeepFace)
        with pytest.raises(face_service.SpoofDetected):
            face_service._get_embedding(np.zeros((8, 8, 3), np.uint8))

    def test_falls_open_when_the_anti_spoof_model_is_unavailable(self, monkeypatch):
        import numpy as np

        from backend.app.services import face_service

        class FakeDeepFace:
            calls = []

            @staticmethod
            def represent(**kwargs):
                FakeDeepFace.calls.append(kwargs.get("anti_spoofing"))
                if kwargs.get("anti_spoofing"):
                    raise OSError("could not download model")
                return [{"embedding": [3.0, 4.0]}]

        monkeypatch.setattr(face_service, "FACE_LIVENESS", True)
        monkeypatch.setattr(face_service, "_get_deepface", lambda: FakeDeepFace)
        emb = face_service._get_embedding(np.zeros((8, 8, 3), np.uint8))
        assert emb is not None and abs(float((emb ** 2).sum()) - 1.0) < 1e-6
        assert FakeDeepFace.calls == [True, None]


class TestRemindersDelete:
    def _make(self, client, auth, title="temp"):
        import datetime

        when = (datetime.datetime.now() + datetime.timedelta(hours=1)).isoformat()
        return client.post("/api/reminders", headers=auth, json={"title": title, "scheduled_at": when}).json()

    def test_delete_removes_it(self, client, auth):
        created = self._make(client, auth)
        assert client.delete(f"/api/reminders/{created['id']}", headers=auth).json() == {"deleted": created["id"]}
        assert all(r["id"] != created["id"] for r in client.get("/api/reminders", headers=auth).json())

    def test_cannot_delete_someone_elses(self, client, auth, db_session, user):
        from backend.app.models import Reminder

        other = User(name="Other")
        db_session.add(other)
        db_session.commit()
        theirs = Reminder(user_id=other.id, title="not yours")
        db_session.add(theirs)
        db_session.commit()
        assert client.delete(f"/api/reminders/{theirs.id}", headers=auth).status_code == 404
        assert db_session.get(Reminder, theirs.id) is not None


class TestAnalyticsAccuracy:
    def test_mood_history_returns_the_dates_behind_each_point(self, client, auth):
        body = client.get("/api/mood/history?days=7", headers=auth).json()
        assert len(body["dates"]) == 7 == len(body["emotions"])
        assert body["dates"] == sorted(body["dates"]), "oldest first"

    def test_recent_emotion_is_not_just_the_all_time_common_one(self, client, auth, db_session, user):
        import datetime

        from backend.app.models import EmotionLog

        old = datetime.datetime.utcnow() - datetime.timedelta(days=5)
        db_session.add_all(
            [EmotionLog(user_id=user.id, source="fused", emotion="sad", created_at=old) for _ in range(5)]
            + [EmotionLog(user_id=user.id, source="fused", emotion="happy")]
        )
        db_session.commit()
        body = client.get("/api/analytics", headers=auth).json()
        assert body["common_emotion"] == "sad"  # all-time
        assert body["recent_emotion"] == "happy"  # last 24h
        assert "avg_emotion" not in body

    def test_recent_emotion_is_null_without_readings(self, client, auth):
        assert client.get("/api/analytics", headers=auth).json()["recent_emotion"] is None

    def test_profile_reports_the_saved_language(self, client, auth):
        client.put("/api/settings/preferences", headers=auth, json={"language": "hinglish"})
        assert client.get("/api/profile", headers=auth).json()["preferred_language"] == "hinglish"


class TestLanguageFollowsTheUser:
    """A saved memory once dictated the reply language; the live message must win."""

    def test_auto_tells_the_model_to_mirror_the_user(self, sandbox_files):
        from backend.app.models import UserPreference
        from backend.app.services.chat_service import build_system_prompt

        prompt = build_system_prompt(1, "Akash", preferences=UserPreference(language="auto"))
        assert "same language and script" in prompt
        assert "only switch when they switch" in prompt

    def test_explicit_language_still_overrides(self, sandbox_files):
        from backend.app.models import UserPreference
        from backend.app.services.chat_service import build_system_prompt

        assert "Hindi" in build_system_prompt(1, "A", preferences=UserPreference(language="hi"))
        assert "Hinglish" in build_system_prompt(1, "A", preferences=UserPreference(language="hinglish"))
