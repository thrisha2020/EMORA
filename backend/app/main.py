import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.routers import (
    analytics,
    assistant,
    auth,
    chat,
    emotion,
    reminders,
    settings,
    stt,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Create tables, then warm the emotion models off the request path."""
    import threading

    from backend.app.config import WARMUP_MODELS
    from backend.app.database import Base, engine
    from backend.app.services import stt_service
    from backend.app.services.emotion_service import warmup as warm_emotion

    Base.metadata.create_all(bind=engine)
    if WARMUP_MODELS:
        # Both are slow the first time (STT ~2min, emotion ~1min). Loading them
        # here keeps that cost off the first voice turn, which otherwise hangs.
        threading.Thread(target=warm_emotion, daemon=True).start()
        threading.Thread(target=stt_service.warmup, daemon=True).start()
    else:
        print("[startup] EMORA_WARMUP=0 — models load lazily; first voice turn will be slow")
    yield


app = FastAPI(title="Emora — Emotion Assistant API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        # Android (Capacitor) serves the bundled UI from these origins and calls
        # this API across origins; without them the phone gets CORS errors.
        "http://localhost",
        "https://localhost",
        "capacitor://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(stt.router, prefix="/api", tags=["stt"])
app.include_router(emotion.router, prefix="/api", tags=["emotion"])
app.include_router(reminders.router, prefix="/api", tags=["reminders"])
app.include_router(analytics.router, prefix="/api", tags=["analytics"])
app.include_router(assistant.router, prefix="/api", tags=["assistant"])
app.include_router(settings.router, prefix="/api", tags=["settings"])


@app.get("/api/health")
def health():
    """Liveness plus model readiness, so the UI can say "warming up" instead of
    appearing to ignore the user while a model loads."""
    from backend.app.services import stt_service
    from backend.app.services.emotion_service import readiness

    from backend.app.config import WARMUP_MODELS

    models = readiness()
    models["stt"] = stt_service.is_ready()
    # A model that failed to load is still "settled" — its fallback path is live.
    text_ready = models["text"] or models["text_fallback"]
    voice_ready = models["voice"] or models["voice_fallback"]
    return {
        "status": "ok",
        "models": models,
        "warmup": WARMUP_MODELS,
        # With warmup disabled nothing preloads, so gating the UI on readiness
        # would disable voice permanently. Report ready and accept a slow first turn.
        "ready": True if not WARMUP_MODELS else bool(text_ready and voice_ready and models["stt"]),
    }


# --- single-process mode -----------------------------------------------------
#
# Serve the built frontend from FastAPI when `emora-frontend/dist` exists. That
# removes the separate Node process entirely: on a memory-constrained machine the
# dev server (several hundred MB) and even `vite preview` (~98 MB) get OOM-killed,
# while this costs almost nothing on top of the API that has to run anyway.
#
# Build once with `npm run build`, then http://localhost:8000 serves the whole app.
# The dev server is still the right choice while working on the UI — it has hot
# reload, which this does not.

_DIST = os.path.join("emora-frontend", "dist")

if os.path.isdir(_DIST):
    app.mount(
        "/assets", StaticFiles(directory=os.path.join(_DIST, "assets")), name="assets"
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        """Static file if it exists, otherwise index.html for client-side routing.

        Registered last so every real /api route matches first. A deep link like
        /chat has no file behind it and must fall through to the SPA shell rather
        than 404.
        """
        # An unmatched /api path is a genuine 404, not a page. Without this the
        # catch-all hands back HTML and the client tries to parse it as JSON.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")

        root = os.path.realpath(_DIST)
        candidate = os.path.realpath(os.path.join(root, full_path))
        # Containment check: a path like ../../.env must never escape dist.
        inside = candidate == root or candidate.startswith(root + os.sep)
        if full_path and inside and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(root, "index.html"))
