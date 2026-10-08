"""Multimodal emotion engine: face + voice tone + text, fused into one vector.

Every modality returns a *normalized probability distribution* over EMOTION_LABELS
rather than a bare label, so fusion is a weighted average of distributions and the
resulting confidence means something. Per-user smoothing is an exponential moving
average over that vector, which removes the frame-to-frame flicker the old
majority-vote smoother still let through.

Models are loaded lazily on first use and cached process-wide:
  face  - DeepFace (opencv -> mtcnn fallback detector)
  voice - wav2vec2 speech-emotion-recognition, prosody heuristics as fallback
  text  - DistilRoBERTa 7-class emotion classifier, lexicon as fallback
"""

import io
import re
import subprocess
import threading
from typing import Optional

import numpy as np

EMOTION_LABELS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"]
_N = len(EMOTION_LABELS)
_IDX = {label: i for i, label in enumerate(EMOTION_LABELS)}

# Per-user EMA state over the fused vector.
_ema: dict[int, np.ndarray] = {}
_EMA_ALPHA = 0.45  # weight of the newest reading

_lock = threading.Lock()
_voice_pipe = None
_text_pipe = None
_voice_failed = False
_text_failed = False

# Candidate SER checkpoints, most trustworthy first. Each is validated on load
# (see _load_voice_pipe) — a checkpoint whose classifier head doesn't actually
# ship trained weights is rejected rather than used to emit noise.
#
# superb/...-superb-er covers 4 classes (ang/neu/hap/sad); those fold into our 7
# and the remaining three simply get no vote from voice, which is honest.
_VOICE_MODELS = [
    "superb/wav2vec2-base-superb-er",
    "ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition",
]

# Head parameters that must be present in the checkpoint. If any are randomly
# initialized the model outputs an untrained (near-uniform) distribution.
_REQUIRED_HEAD_SUFFIXES = ("classifier.weight", "classifier.bias")
_TEXT_MODEL = "j-hartmann/emotion-english-distilroberta-base"

# Checkpoint label -> our canonical label.
_LABEL_ALIASES = {
    "anger": "angry", "angry": "angry", "ang": "angry",
    "disgust": "disgust", "dis": "disgust",
    "fear": "fear", "fearful": "fear", "fea": "fear",
    "happy": "happy", "happiness": "happy", "joy": "happy", "hap": "happy",
    "neutral": "neutral", "calm": "neutral", "neu": "neutral",
    "sad": "sad", "sadness": "sad", "sadness ": "sad",
    "surprise": "surprise", "surprised": "surprise", "sur": "surprise",
}


# --- helpers -----------------------------------------------------------------

def _zeros() -> np.ndarray:
    return np.zeros(_N, dtype=np.float64)


def _uniform() -> np.ndarray:
    return np.full(_N, 1.0 / _N)


def _normalize(vec: np.ndarray) -> np.ndarray:
    total = float(vec.sum())
    return _uniform() if total <= 0 else vec / total


def _as_result(vec: np.ndarray, source: str) -> dict:
    vec = _normalize(vec)
    top = int(np.argmax(vec))
    return {
        "emotion": EMOTION_LABELS[top],
        "confidence": float(vec[top]),
        "scores": {label: float(vec[i]) for i, label in enumerate(EMOTION_LABELS)},
        "source": source,
    }


def _vec_from_scores(scores: dict[str, float]) -> np.ndarray:
    """Fold arbitrary checkpoint labels into our 7-class vector."""
    vec = _zeros()
    for raw, value in scores.items():
        canonical = _LABEL_ALIASES.get(str(raw).strip().lower())
        if canonical:
            vec[_IDX[canonical]] += float(value)
    return _normalize(vec)


def _device() -> str:
    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


# --- face --------------------------------------------------------------------

def analyze_face_emotion(image: np.ndarray) -> Optional[dict]:
    """DeepFace emotion over one frame. None when no face is found."""
    from deepface import DeepFace

    for backend in ("opencv", "mtcnn"):
        try:
            result = DeepFace.analyze(
                img_path=image,
                actions=["emotion"],
                detector_backend=backend,
                enforce_detection=True,
                silent=True,
            )
            if isinstance(result, list):
                result = result[0]
            emotions = result.get("emotion") or {}
            if not emotions:
                continue
            return _as_result(_vec_from_scores(emotions), "face")
        except Exception:
            continue
    return None


# --- voice -------------------------------------------------------------------

def _load_voice_pipe():
    global _voice_pipe, _voice_failed
    if _voice_pipe is not None or _voice_failed:
        return _voice_pipe
    with _lock:
        if _voice_pipe is not None or _voice_failed:
            return _voice_pipe
        try:
            from transformers import (
                AutoFeatureExtractor,
                AutoModelForAudioClassification,
                pipeline,
            )

            device = _device()
            for name in _VOICE_MODELS:
                try:
                    model, info = AutoModelForAudioClassification.from_pretrained(
                        name, output_loading_info=True
                    )
                    missing = [
                        k
                        for k in info.get("missing_keys", [])
                        if k.endswith(_REQUIRED_HEAD_SUFFIXES)
                    ]
                    if missing:
                        # The head is randomly initialized — predictions would be
                        # noise dressed up as probabilities. Skip it.
                        print(
                            f"[emotion] voice SER {name} rejected: untrained head {missing}"
                        )
                        continue
                    _voice_pipe = pipeline(
                        "audio-classification",
                        model=model,
                        feature_extractor=AutoFeatureExtractor.from_pretrained(name),
                        device=device,
                        top_k=None,
                    )
                    print(f"[emotion] voice SER loaded: {name} on {device}")
                    return _voice_pipe
                except Exception as e:
                    print(f"[emotion] voice SER {name} unavailable: {e}")
            _voice_failed = True
            print("[emotion] no usable SER checkpoint — voice falls back to prosody")
        except Exception as e:
            print(f"[emotion] transformers unavailable for voice: {e}")
            _voice_failed = True
    return _voice_pipe


def _decode_audio(audio_bytes: bytes) -> Optional[np.ndarray]:
    """Decode arbitrary browser audio to 16 kHz mono float32.

    The browser sends webm/opus, which libsndfile can't open, so ffmpeg does the
    conversion (same approach as stt_service). Direct librosa load is the
    fallback for formats libsndfile does handle, e.g. plain WAV.
    """
    import librosa

    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", "pipe:0", "-ac", "1", "-ar", "16000",
             "-f", "f32le", "pipe:1"],
            input=audio_bytes,
            capture_output=True,
            timeout=20,
        )
        if proc.returncode == 0 and proc.stdout:
            y = np.frombuffer(proc.stdout, dtype=np.float32)
            if y.size >= 1600:  # at least 0.1s
                return y.astype(np.float64)
    except (OSError, subprocess.SubprocessError):
        pass

    try:
        y, _ = librosa.load(io.BytesIO(audio_bytes), sr=16000, mono=True)
        return y if y.size >= 1600 else None
    except Exception:
        return None


def _prosody_emotion(y: np.ndarray) -> np.ndarray:
    """Fallback when no SER model is available.

    Uses three cues that separate arousal and valence reasonably well: RMS energy
    (loudness), fundamental-frequency mean and variance (pitch and its movement),
    and speaking rate via onset density. Deliberately conservative — it leans
    neutral unless a cue is clearly out of band.
    """
    import librosa

    vec = _uniform().copy()
    try:
        rms = float(np.mean(librosa.feature.rms(y=y)))
        f0 = librosa.yin(y, fmin=60, fmax=400, sr=16000)
        f0 = f0[np.isfinite(f0)]
        pitch_mean = float(np.mean(f0)) if f0.size else 0.0
        pitch_std = float(np.std(f0)) if f0.size else 0.0
        onsets = librosa.onset.onset_detect(y=y, sr=16000, units="time")
        rate = len(onsets) / max(len(y) / 16000.0, 0.1)

        high_arousal = rms > 0.06 and pitch_std > 45
        low_arousal = rms < 0.02 and pitch_std < 25

        if high_arousal and pitch_mean > 190:
            vec[_IDX["happy"]] += 0.9
            vec[_IDX["surprise"]] += 0.5
        elif high_arousal:
            vec[_IDX["angry"]] += 0.9
            vec[_IDX["fear"]] += 0.3
        elif low_arousal:
            vec[_IDX["sad"]] += 1.0
        else:
            vec[_IDX["neutral"]] += 0.8

        if rate > 4.5:
            vec[_IDX["fear"]] += 0.25
        elif rate < 1.5:
            vec[_IDX["sad"]] += 0.25
    except Exception:
        return _uniform()
    return _normalize(vec)


def analyze_voice_emotion(audio_bytes: bytes) -> Optional[dict]:
    """Emotion from vocal tone. None when the audio can't be decoded."""
    y = _decode_audio(audio_bytes)
    if y is None:
        return None

    pipe = _load_voice_pipe()
    if pipe is not None:
        try:
            preds = pipe({"raw": y, "sampling_rate": 16000})
            scores = {p["label"]: p["score"] for p in preds}
            vec = _vec_from_scores(scores)
            if float(vec.max()) > 1.0 / _N + 1e-6:  # model said something useful
                return _as_result(vec, "voice")
        except Exception as e:
            print(f"[emotion] voice inference failed, using prosody: {e}")

    return _as_result(_prosody_emotion(y), "voice:prosody")


# --- text --------------------------------------------------------------------

_POSITIVE = {
    "happy", "great", "good", "love", "wonderful", "amazing", "excellent",
    "glad", "joy", "excited", "grateful", "awesome", "brilliant", "fun", "best",
}
_NEGATIVE = {
    "sad", "bad", "terrible", "awful", "horrible", "upset", "depressed",
    "lonely", "worried", "anxious", "miserable", "hopeless", "tired",
    "exhausted", "disappointed", "stressed", "hurt",
}
_ANGRY = {"angry", "furious", "annoyed", "frustrated", "hate", "rage", "mad"}
_FEAR = {"scared", "afraid", "fear", "terrified", "nervous", "panic"}


def _load_text_pipe():
    global _text_pipe, _text_failed
    if _text_pipe is not None or _text_failed:
        return _text_pipe
    with _lock:
        if _text_pipe is not None or _text_failed:
            return _text_pipe
        try:
            from transformers import pipeline

            device = _device()
            _text_pipe = pipeline(
                "text-classification", model=_TEXT_MODEL, device=device, top_k=None
            )
            print(f"[emotion] text classifier loaded: {_TEXT_MODEL} on {device}")
        except Exception as e:
            print(f"[emotion] text classifier unavailable: {e}")
            _text_failed = True
    return _text_pipe


def _lexicon_emotion(text: str) -> np.ndarray:
    words = set(re.sub(r"[^\w\s]", " ", text.lower()).split())
    vec = _uniform().copy()
    vec[_IDX["happy"]] += 0.6 * len(words & _POSITIVE)
    vec[_IDX["sad"]] += 0.6 * len(words & _NEGATIVE)
    vec[_IDX["angry"]] += 0.7 * len(words & _ANGRY)
    vec[_IDX["fear"]] += 0.7 * len(words & _FEAR)
    return _normalize(vec)


def analyze_text_sentiment(text: str) -> Optional[dict]:
    """Emotion from word choice. None for empty input."""
    if not text or not text.strip():
        return None

    pipe = _load_text_pipe()
    if pipe is not None:
        try:
            preds = pipe(text[:512])
            if preds and isinstance(preds[0], list):
                preds = preds[0]
            scores = {p["label"]: p["score"] for p in preds}
            return _as_result(_vec_from_scores(scores), "text")
        except Exception as e:
            print(f"[emotion] text inference failed, using lexicon: {e}")

    return _as_result(_lexicon_emotion(text), "text:lexicon")


# --- fusion ------------------------------------------------------------------

# Base trust per modality. Face reads strongest but goes blind off-camera; text
# is the most literal signal; voice tone sits between the two.
_BASE_WEIGHTS = {"face": 0.45, "voice": 0.30, "text": 0.25}


def _peakiness(vec: np.ndarray) -> float:
    """0 for a flat (uninformative) distribution, ~1 for a confident one."""
    uniform = 1.0 / _N
    return float(np.clip((vec.max() - uniform) / (1.0 - uniform), 0.0, 1.0))


def fuse_emotions(
    face_result: Optional[dict] = None,
    voice_result: Optional[dict] = None,
    text_result: Optional[dict] = None,
) -> dict:
    """Weighted average of whichever modality distributions are available.

    Each modality's weight is its base trust scaled by how peaked its own
    distribution is, so a hedging model contributes proportionally less than a
    confident one instead of counting as a full vote.
    """
    contributions: list[tuple[str, np.ndarray, float]] = []
    for name, result in (
        ("face", face_result),
        ("voice", voice_result),
        ("text", text_result),
    ):
        if not result:
            continue
        vec = np.array([result["scores"].get(l, 0.0) for l in EMOTION_LABELS])
        vec = _normalize(vec)
        weight = _BASE_WEIGHTS[name] * (0.35 + 0.65 * _peakiness(vec))
        contributions.append((name, vec, weight))

    if not contributions:
        return {
            "emotion": "neutral",
            "confidence": 0.0,
            "scores": {l: 1.0 / _N for l in EMOTION_LABELS},
            "sources": [],
            "agreement": 0.0,
        }

    total_weight = sum(w for _, _, w in contributions)
    fused = _zeros()
    for _, vec, weight in contributions:
        fused += vec * weight
    fused = _normalize(fused / total_weight)

    # Agreement = fraction of modalities whose own top label matches the fused one.
    top_label = EMOTION_LABELS[int(np.argmax(fused))]
    agreeing = sum(
        1 for _, vec, _ in contributions if EMOTION_LABELS[int(np.argmax(vec))] == top_label
    )
    agreement = agreeing / len(contributions)

    result = _as_result(fused, "+".join(n for n, _, _ in contributions))
    result["sources"] = [n for n, _, _ in contributions]
    result["agreement"] = agreement
    # A lone modality shouldn't report the same certainty as three that concur.
    result["confidence"] = float(result["confidence"] * (0.6 + 0.4 * agreement))
    return result


def smooth(user_id: int, result: dict) -> dict:
    """Exponential moving average over the fused vector, per user."""
    vec = np.array([result["scores"].get(l, 0.0) for l in EMOTION_LABELS])
    vec = _normalize(vec)
    prev = _ema.get(user_id)
    blended = vec if prev is None else _EMA_ALPHA * vec + (1 - _EMA_ALPHA) * prev
    _ema[user_id] = blended

    smoothed = _as_result(blended, result.get("source", "fused"))
    smoothed["sources"] = result.get("sources", [])
    smoothed["agreement"] = result.get("agreement", 0.0)
    smoothed["raw_emotion"] = result["emotion"]
    return smoothed


def clear_history(user_id: int) -> None:
    _ema.pop(user_id, None)


def warmup() -> None:
    """Preload both checkpoints so the first real request isn't slow."""
    _load_text_pipe()
    _load_voice_pipe()


def readiness() -> dict:
    """Which emotion models are loaded — surfaced through /api/health."""
    return {
        "text": _text_pipe is not None,
        "voice": _voice_pipe is not None,
        # A failed load still counts as settled: the fallback path is live.
        "text_fallback": _text_failed,
        "voice_fallback": _voice_failed,
    }
