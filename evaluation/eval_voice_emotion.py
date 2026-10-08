"""Speech-emotion evaluation (synopsis §5.4).

Reads labelled clips from `data/eval/voice/<emotion>/*.wav`. Capture them with
`python scripts/capture_eval_samples.py voice`, or drop in RAVDESS/CREMA-D
arranged into the same layout.

Also scores the prosody fallback on the same clips, giving the §5.5 comparison
between the wav2vec2 model and the heuristic that stands in for it.
"""

import glob
import os

import numpy as np

from backend.app.services import emotion_service as es
from evaluation.metrics import ClassificationResult

VOICE_DIR = "data/eval/voice"


def run() -> tuple[list[ClassificationResult], str]:
    classes = sorted(d for d in glob.glob(f"{VOICE_DIR}/*") if os.path.isdir(d))
    if not classes:
        return [], (
            f"_No labelled clips at `{VOICE_DIR}/<emotion>/*.wav`. "
            "Run `python scripts/capture_eval_samples.py voice`, or unpack "
            "RAVDESS/CREMA-D into that layout, then re-run._\n"
        )

    y_true, model_pred, prosody_pred = [], [], []
    for class_dir in classes:
        label = os.path.basename(class_dir)
        for path in sorted(glob.glob(os.path.join(class_dir, "*"))):
            with open(path, "rb") as f:
                audio = f.read()
            result = es.analyze_voice_emotion(audio)
            if result is None:
                continue
            y_true.append(label)
            model_pred.append(result["emotion"])

            decoded = es._decode_audio(audio)
            prosody_pred.append(
                es.EMOTION_LABELS[int(np.argmax(es._prosody_emotion(decoded)))]
                if decoded is not None
                else "neutral"
            )

    results = [
        ClassificationResult(
            name="Speech emotion — wav2vec2 SER (deployed)",
            labels=es.EMOTION_LABELS,
            y_true=y_true,
            y_pred=model_pred,
            notes=(
                "superb/wav2vec2-base-superb-er. Note it predicts only 4 of the 7 "
                "classes (angry/happy/neutral/sad), so fear, disgust and surprise "
                "can never be recalled from voice alone — visible in the matrix."
            ),
        ),
        ClassificationResult(
            name="Speech emotion — prosody baseline (fallback)",
            labels=es.EMOTION_LABELS,
            y_true=y_true,
            y_pred=prosody_pred,
            notes="Energy/pitch/rate heuristic used when the SER model is unavailable.",
        ),
    ]
    return results, ""


if __name__ == "__main__":
    from evaluation.metrics import render

    results, message = run()
    if not results:
        print(message)
    for r in results:
        print(render(r))
