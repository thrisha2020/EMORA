"""Fast head-position tracking for avatar gaze.

Deliberately separate from emotion_service: DeepFace takes hundreds of
milliseconds and runs every few seconds, which is fine for a mood reading but
far too slow to make the avatar appear to watch you. A Haar cascade runs in
~20ms on a small frame, so the frontend can poll several times a second, and it
needs no extra dependency or model download — opencv is already required, and
is pinned <5.0 precisely because 5.x drops the bundled cascade data.

Only position is returned; identity and emotion stay with the other services.
"""

import os
from typing import Optional

import numpy as np

_cascade = None
_profile_cascade = None


def _get_cascades():
    """Frontal detector, plus a profile detector for when the user turns away."""
    global _cascade, _profile_cascade
    if _cascade is None:
        import cv2

        base = cv2.data.haarcascades
        _cascade = cv2.CascadeClassifier(
            os.path.join(base, "haarcascade_frontalface_default.xml")
        )
        _profile_cascade = cv2.CascadeClassifier(
            os.path.join(base, "haarcascade_profileface.xml")
        )
    return _cascade, _profile_cascade


def track(frame: np.ndarray) -> Optional[dict]:
    """Locate the dominant face and return its position normalised to [-1, 1].

    `x` is +1 at the right edge of the *image*; the caller decides whether to
    mirror. `scale` is the face height as a fraction of frame height, which is a
    usable proxy for how close the user is.
    """
    import cv2

    frontal, profile = _get_cascades()

    # Downscale before detecting: accuracy at this task is dominated by the
    # cascade, not resolution, and a smaller frame keeps the poll cheap.
    height, width = frame.shape[:2]
    target_w = 320
    if width > target_w:
        scale_factor = target_w / width
        frame = cv2.resize(frame, (target_w, int(height * scale_factor)))
        height, width = frame.shape[:2]

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)  # helps a lot under uneven lighting

    faces = frontal.detectMultiScale(gray, 1.15, 5, minSize=(50, 50))
    if len(faces) == 0 and profile is not None:
        faces = profile.detectMultiScale(gray, 1.15, 5, minSize=(50, 50))
    if len(faces) == 0:
        return None

    # Largest face wins — the user is normally nearest the camera.
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    cx = x + w / 2.0
    cy = y + h / 2.0

    return {
        "x": float(np.clip((cx / width) * 2 - 1, -1, 1)),
        "y": float(np.clip((cy / height) * 2 - 1, -1, 1)),
        "scale": float(h / height),
    }
