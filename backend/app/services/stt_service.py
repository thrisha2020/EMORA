"""Speech-to-text service.

Primary engine: NVIDIA Parakeet-TDT 0.6B (via pure-PyTorch `nano-parakeet`),
running on Apple MPS / CPU. Whisper-tiny is kept as an automatic fallback if
Parakeet fails to load or transcribe.
"""

import os
import tempfile
import subprocess

_PARAKEET = None
_WHISPER = None
_DEVICE = None


def _device():
    global _DEVICE
    if _DEVICE is None:
        import torch
        if torch.backends.mps.is_available():
            _DEVICE = "mps"
        else:
            _DEVICE = "cpu"
    return _DEVICE


def _get_parakeet():
    global _PARAKEET
    if _PARAKEET is None:
        import nano_parakeet as npk
        _PARAKEET = npk.from_pretrained(
            "nvidia/parakeet-tdt-0.6b-v3", device=_device()
        )
    return _PARAKEET


def _get_whisper():
    global _WHISPER
    if _WHISPER is None:
        import whisper
        _WHISPER = whisper.load_model("tiny")
    return _WHISPER


def _save_temp(audio_bytes: bytes) -> tuple[str | None, list[str]]:
    """Write the upload and convert it to 16 kHz mono WAV.

    Unique names per call: fixed ones (`_emotion_audio.wav`) were shared by every
    request, so two concurrent uploads overwrote each other and a caller could get
    someone else's transcript. Returns (wav path or None, paths to clean up).
    """
    raw_fd, raw_path = tempfile.mkstemp(prefix="emora_stt_", suffix=".raw")
    with os.fdopen(raw_fd, "wb") as f:
        f.write(audio_bytes)
    wav_path = raw_path[: -len(".raw")] + ".wav"
    made = [raw_path, wav_path]

    # 16kHz mono WAV works with soundfile, whisper and parakeet alike.
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", raw_path, "-ac", "1", "-ar", "16000", wav_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=30,  # a malformed upload must not wedge a worker thread
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None, made  # invalid or empty audio
    except FileNotFoundError:
        # ffmpeg missing: a clear message beats an uncaught 500.
        raise RuntimeError("ffmpeg is not installed — speech-to-text needs it") from None

    return wav_path, made


def _cleanup(paths: list[str]) -> None:
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            pass


def transcribe(audio_bytes: bytes) -> dict:
    if not audio_bytes or len(audio_bytes) < 100:
        return {"text": "", "language": "en"}

    audio_path, temps = _save_temp(audio_bytes)
    if not audio_path:
        _cleanup(temps)
        return {"text": "", "language": "en"}

    try:
        model = _get_parakeet()
        text = model.transcribe(audio_path)
        return {"text": text.strip(), "language": "en"}
    except Exception:
        try:
            model = _get_whisper()
            result = model.transcribe(audio_path)
            return {
                "text": result["text"].strip(),
                "language": result.get("language", "en"),
            }
        except Exception:
            return {"text": "", "language": "en"}
    finally:
        _cleanup(temps)


def warmup() -> bool:
    """Load the STT model ahead of the first request.

    Cold-loading Parakeet takes ~2 minutes, and it used to happen inside the
    first voice turn — which looked exactly like the assistant ignoring you.
    """
    try:
        _get_parakeet()
        return True
    except Exception as e:
        print(f"[stt] Parakeet warmup failed ({e}); trying Whisper")
        try:
            _get_whisper()
            return True
        except Exception as e2:
            print(f"[stt] Whisper warmup failed too: {e2}")
            return False


def is_ready() -> bool:
    return _PARAKEET is not None or _WHISPER is not None
