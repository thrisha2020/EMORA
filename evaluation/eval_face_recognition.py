"""Face recognition evaluation (synopsis §5.4 — "identification accuracy").

Two modes:

1. **Full identification** when labelled images exist at
   `data/eval/faces/<person>/*.jpg` — accuracy, per-person precision/recall/F1,
   confusion matrix, and a threshold sweep giving the false-accept / false-reject
   trade-off. Capture these with `python scripts/capture_eval_samples.py faces`.

2. **Separability analysis** otherwise, using the embeddings already enrolled in
   the database. It cannot measure identification accuracy — that needs fresh
   images — but it does show whether enrolled users are far enough apart in
   embedding space for the 0.8 threshold to distinguish them, which is the
   property recognition depends on.
"""

import glob
import json
import os

import numpy as np

from evaluation.metrics import ClassificationResult, markdown_table

FACE_DIR = "data/eval/faces"
THRESHOLD = 0.8  # matches face_service


def _enrolled_embeddings() -> dict[str, np.ndarray]:
    from backend.app.database import SessionLocal
    from backend.app.models import User

    db = SessionLocal()
    try:
        out = {}
        for u in db.query(User).filter(User.face_embedding.isnot(None)).all():
            emb = np.array(json.loads(u.face_embedding), dtype=float)
            norm = np.linalg.norm(emb)
            out[f"{u.name}#{u.id}"] = emb / norm if norm else emb
        return out
    finally:
        db.close()


def separability() -> str:
    """How far apart are enrolled users in embedding space?"""
    embeddings = _enrolled_embeddings()
    names = sorted(embeddings)
    if len(names) < 2:
        return "_Fewer than two enrolled users — separability needs at least two._\n"

    rows, inter = [], []
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            d = float(np.linalg.norm(embeddings[a] - embeddings[b]))
            inter.append(d)
            rows.append([a, b, f"{d:.3f}", "separated" if d > THRESHOLD else "COLLISION"])

    collisions = sum(1 for r in rows if r[3] == "COLLISION")
    lines = [
        "### Face recognition — embedding separability",
        "",
        "_Pairwise L2 distance between enrolled users' normalised Facenet "
        "embeddings. Any pair closer than the threshold could be confused for "
        "one another, so this bounds identification accuracy from below._",
        "",
        f"- Enrolled users: **{len(names)}**  ·  Pairs: **{len(rows)}**",
        f"- Decision threshold: **{THRESHOLD}**",
        f"- Min inter-user distance: **{min(inter):.3f}**",
        f"- Mean inter-user distance: **{float(np.mean(inter)):.3f}**",
        f"- Pairs below threshold (would collide): **{collisions}**",
        "",
        markdown_table(rows, ["User A", "User B", "L2 distance", "Verdict"]),
        "",
    ]
    return "\n".join(lines)


def identification() -> tuple[ClassificationResult | None, str]:
    """Full accuracy over labelled images, if any have been captured."""
    people = sorted(
        d for d in glob.glob(os.path.join(FACE_DIR, "*")) if os.path.isdir(d)
    )
    if not people:
        return None, (
            f"_No labelled images at `{FACE_DIR}/<person>/*.jpg`. "
            "Run `python scripts/capture_eval_samples.py faces` to record them, "
            "then re-run for identification accuracy and a threshold sweep._\n"
        )

    from backend.app.camera import bytes_to_frame
    from backend.app.services.face_service import _get_embedding

    enrolled = _enrolled_embeddings()
    if not enrolled:
        return None, "_No enrolled users to match against._\n"

    y_true, y_pred, distances = [], [], []
    for person_dir in people:
        person = os.path.basename(person_dir)
        for path in sorted(glob.glob(os.path.join(person_dir, "*"))):
            with open(path, "rb") as f:
                frame = bytes_to_frame(f.read())
            if frame is None:
                continue
            emb = _get_embedding(frame)
            if emb is None:
                y_true.append(person)
                y_pred.append("no_face")
                continue
            best, best_d = None, float("inf")
            for name, ref in enrolled.items():
                d = float(np.linalg.norm(emb - ref))
                if d < best_d:
                    best, best_d = name.split("#")[0], d
            distances.append((person, best, best_d))
            y_true.append(person)
            y_pred.append(best if best_d <= THRESHOLD else "rejected")

    labels = sorted(set(y_true) | set(y_pred))
    result = ClassificationResult(
        name="Face recognition — identification accuracy",
        labels=labels,
        y_true=y_true,
        y_pred=y_pred,
        notes=f"{len(y_true)} images across {len(people)} people, threshold {THRESHOLD}.",
    )

    # Threshold sweep: how do false accepts and false rejects trade off?
    rows = []
    for t in (0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1):
        correct = sum(1 for true, best, d in distances if d <= t and best == true)
        wrong = sum(1 for true, best, d in distances if d <= t and best != true)
        rejected = sum(1 for _, _, d in distances if d > t)
        total = len(distances) or 1
        rows.append([
            f"{t:.1f}",
            f"{correct / total:.3f}",
            f"{wrong / total:.3f}",
            f"{rejected / total:.3f}",
        ])
    sweep = "\n".join([
        "**Threshold sweep**",
        "",
        markdown_table(rows, ["Threshold", "Correct accept", "False accept", "Reject"]),
        "",
    ])
    return result, sweep


if __name__ == "__main__":
    from evaluation.metrics import render

    result, extra = identification()
    if result:
        print(render(result))
    print(extra)
    print(separability())
