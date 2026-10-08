from typing import Optional
import json

import numpy as np
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.app.config import FACE_LIVENESS
from backend.app.models import User

_deepface = None


def _get_deepface():
    global _deepface
    if _deepface is None:
        from deepface import DeepFace
        _deepface = DeepFace
    return _deepface


def _normalize(emb: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(emb)
    if norm > 0:
        return emb / norm
    return emb


class SpoofDetected(Exception):
    """The frame looks like a photo or screen, not a live face."""


def _get_embedding(image: np.ndarray) -> Optional[np.ndarray]:
    """Facenet embedding for the largest face, or None when no face is found.

    With FACE_LIVENESS on, DeepFace's anti-spoofing model runs first and a replayed
    photo raises SpoofDetected. It fails *open*: if that model can't be loaded (no
    download yet, offline) the login still proceeds rather than locking everyone out.
    """
    DeepFace = _get_deepface()
    for backend in ["opencv", "ssd"]:
        try:
            result = DeepFace.represent(
                img_path=image,
                model_name="Facenet",
                enforce_detection=True,
                detector_backend=backend,
                anti_spoofing=FACE_LIVENESS,
            )
            emb = np.array(result[0]["embedding"])
            return _normalize(emb)
        except ValueError as e:
            if FACE_LIVENESS and "spoof" in str(e).lower():
                raise SpoofDetected(
                    "That looks like a photo or a screen. Please look at the camera yourself."
                ) from e
            continue
        except Exception:
            if FACE_LIVENESS:
                # Anti-spoofing model unavailable or failed — retry without it.
                try:
                    result = DeepFace.represent(
                        img_path=image,
                        model_name="Facenet",
                        enforce_detection=True,
                        detector_backend=backend,
                        anti_spoofing=False,
                    )
                    return _normalize(np.array(result[0]["embedding"]))
                except Exception:
                    continue
            continue
    return None


def register_face(db: Session, name: str, image: np.ndarray) -> dict:
    embedding = _get_embedding(image)
    if embedding is None:
        raise ValueError("No face detected. Ensure good lighting and look directly at the camera.")
    user = User(name=name, face_embedding=json.dumps(embedding.tolist()))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"user_id": user.id, "name": user.name}


def recognize_face(
    db: Session, image: np.ndarray, name: Optional[str] = None
) -> Optional[dict]:
    """Match a face against enrolled users.

    When `name` is given the search is scoped to users with that name, so the
    spoken name and the face must agree — a stronger check than face alone.
    """
    query_emb = _get_embedding(image)
    if query_emb is None:
        return {"error": "No face detected. Ensure good lighting and look directly at the camera."}

    query = db.query(User).filter(User.face_embedding.isnot(None))
    if name:
        query = query.filter(func.lower(User.name) == name.strip().lower())
    users = query.all()
    if not users:
        return None

    best_match = None
    best_dist = float("inf")

    for user in users:
        stored_emb = np.array(json.loads(user.face_embedding))
        stored_norm = _normalize(stored_emb)
        dist = np.linalg.norm(query_emb - stored_norm)
        if dist < best_dist:
            best_dist = dist
            best_match = user

    threshold = 0.8
    if best_dist > threshold:
        return {
            "error": "Face not recognized",
            "best_distance": float(best_dist),
            "threshold": threshold,
        }

    return {"user_id": best_match.id, "name": best_match.name, "distance": float(best_dist)}
