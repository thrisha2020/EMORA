"""Facial-emotion evaluation (synopsis §5.4 — "classification accuracy").

Reads labelled images from `data/eval/emotions/<emotion>/*.jpg`. Capture them
with `python scripts/capture_eval_samples.py emotions`, or drop in a public set
such as FER2013 arranged into the same folder layout.
"""

import glob
import os

from backend.app.services import emotion_service as es
from evaluation.metrics import ClassificationResult

EMOTION_DIR = "data/eval/emotions"


def run() -> tuple[ClassificationResult | None, str]:
    classes = sorted(d for d in glob.glob(f"{EMOTION_DIR}/*") if os.path.isdir(d))
    if not classes:
        return None, (
            f"_No labelled images at `{EMOTION_DIR}/<emotion>/*.jpg`. "
            "Run `python scripts/capture_eval_samples.py emotions`, or unpack a "
            "public set (FER2013) into that layout, then re-run._\n"
        )

    from backend.app.camera import bytes_to_frame

    y_true, y_pred, undetected = [], [], 0
    for class_dir in classes:
        label = os.path.basename(class_dir)
        for path in sorted(glob.glob(os.path.join(class_dir, "*"))):
            with open(path, "rb") as f:
                frame = bytes_to_frame(f.read())
            if frame is None:
                continue
            result = es.analyze_face_emotion(frame)
            if result is None:
                undetected += 1
                continue  # no face found: a detection failure, not a misclassification
            y_true.append(label)
            y_pred.append(result["emotion"])

    note = f"DeepFace emotion model. {undetected} image(s) had no detectable face."
    return (
        ClassificationResult(
            name="Facial emotion — DeepFace",
            labels=es.EMOTION_LABELS,
            y_true=y_true,
            y_pred=y_pred,
            notes=note,
        ),
        "",
    )


if __name__ == "__main__":
    from evaluation.metrics import render

    result, message = run()
    print(render(result) if result else message)
