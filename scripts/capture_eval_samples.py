#!/usr/bin/env python3
"""Record labelled samples for the evaluations that need real data.

Face-emotion and voice-emotion accuracy cannot be measured without ground truth,
and the public corpora (FER2013, RAVDESS) are large downloads. This records your
own, which takes a few minutes and gives numbers that reflect your actual users
and hardware — arguably more honest for the report than a benchmark number
copied from a paper.

    python scripts/capture_eval_samples.py faces      # identification
    python scripts/capture_eval_samples.py emotions   # facial emotion
    python scripts/capture_eval_samples.py voice      # speech emotion

Everything is written under data/eval/ and is gitignored.
"""

import os
import sys
import time

EMOTIONS = ["neutral", "happy", "sad", "angry", "surprise", "fear", "disgust"]
PER_CLASS = 5


def _countdown(message: str, seconds: int = 3) -> None:
    print(f"\n{message}")
    for i in range(seconds, 0, -1):
        print(f"  {i}…", end="\r", flush=True)
        time.sleep(1)
    print("  capturing!   ")


def capture_faces() -> None:
    """Photos per person, for identification accuracy."""
    import cv2

    name = input("Person's name (must match how they are enrolled): ").strip()
    if not name:
        return
    out = os.path.join("data/eval/faces", name)
    os.makedirs(out, exist_ok=True)

    cam = cv2.VideoCapture(0)
    if not cam.isOpened():
        sys.exit("Could not open the camera.")
    print(f"\nCapturing 8 shots of {name}. Vary angle and lighting between each —")
    print("that is what makes the accuracy number meaningful.")
    try:
        for i in range(8):
            _countdown(f"Shot {i + 1}/8 — move slightly, change the light if you can")
            ok, frame = cam.read()
            if ok:
                path = os.path.join(out, f"{i:02d}.jpg")
                cv2.imwrite(path, frame)
                print(f"  saved {path}")
    finally:
        cam.release()
    print(f"\nDone. {name} has {len(os.listdir(out))} images.")


def capture_emotions() -> None:
    """Posed expressions per emotion, for facial-emotion accuracy."""
    import cv2

    cam = cv2.VideoCapture(0)
    if not cam.isOpened():
        sys.exit("Could not open the camera.")
    print(f"\n{PER_CLASS} shots for each of {len(EMOTIONS)} emotions.")
    print("Hold the expression clearly — posed data is the standard for this test.")
    try:
        for emotion in EMOTIONS:
            out = os.path.join("data/eval/emotions", emotion)
            os.makedirs(out, exist_ok=True)
            input(f"\n--- {emotion.upper()} --- press Enter when ready ")
            for i in range(PER_CLASS):
                _countdown(f"  {emotion} {i + 1}/{PER_CLASS}", 2)
                ok, frame = cam.read()
                if ok:
                    cv2.imwrite(os.path.join(out, f"{i:02d}.jpg"), frame)
    finally:
        cam.release()
    print("\nDone. Run: python -m evaluation.eval_face_emotion")


def capture_voice() -> None:
    """Spoken clips per emotion, for speech-emotion accuracy."""
    try:
        import sounddevice as sd
        import soundfile as sf
    except ImportError:
        sys.exit(
            "Needs sounddevice: pip install sounddevice\n"
            "(soundfile is already a project dependency.)"
        )

    sr, seconds = 16000, 3
    print(f"\n{PER_CLASS} clips for each of {len(EMOTIONS)} emotions, {seconds}s each.")
    print("Say any sentence, but say it *in* that emotion — tone is what is measured.")
    for emotion in EMOTIONS:
        out = os.path.join("data/eval/voice", emotion)
        os.makedirs(out, exist_ok=True)
        input(f"\n--- {emotion.upper()} --- press Enter when ready ")
        for i in range(PER_CLASS):
            _countdown(f"  {emotion} {i + 1}/{PER_CLASS} — speak after the countdown", 2)
            audio = sd.rec(int(seconds * sr), samplerate=sr, channels=1)
            sd.wait()
            sf.write(os.path.join(out, f"{i:02d}.wav"), audio, sr)
            print("  saved")
    print("\nDone. Run: python -m evaluation.eval_voice_emotion")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "faces":
        capture_faces()
    elif mode == "emotions":
        capture_emotions()
    elif mode == "voice":
        capture_voice()
    else:
        print(__doc__)
