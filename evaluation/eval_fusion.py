"""Emotion fusion evaluation (synopsis §5.4 — the multimodal combination).

Fusion is project code rather than a pretrained model, so it can be tested
directly: feed known per-modality distributions and check the combined verdict.
That isolates the fusion rule from the accuracy of the individual detectors —
useful, because a fusion bug and a weak detector look identical end-to-end.

Cases cover the situations the rule exists to handle: agreement, disagreement,
a hedging modality, a single signal, and no signal at all.
"""

from backend.app.services import emotion_service as es
from evaluation.metrics import ClassificationResult, markdown_table


def _modality(top: str, confidence: float) -> dict:
    """A modality result peaked on `top` with the rest spread evenly."""
    rest = (1.0 - confidence) / (len(es.EMOTION_LABELS) - 1)
    scores = {l: rest for l in es.EMOTION_LABELS}
    scores[top] = confidence
    return {"emotion": top, "confidence": confidence, "scores": scores, "source": "test"}


# (face, voice, text, expected) — None means that modality is unavailable.
CASES = [
    (("happy", 0.9), ("happy", 0.8), ("happy", 0.9), "happy"),
    (("sad", 0.85), ("sad", 0.75), ("sad", 0.9), "sad"),
    (("angry", 0.8), ("angry", 0.7), ("angry", 0.85), "angry"),
    (("neutral", 0.7), ("neutral", 0.7), ("neutral", 0.8), "neutral"),
    # Two agree, one dissents — the majority should carry.
    (("sad", 0.85), ("sad", 0.8), ("happy", 0.7), "sad"),
    (("happy", 0.9), ("neutral", 0.5), ("happy", 0.85), "happy"),
    (("angry", 0.85), ("angry", 0.8), ("neutral", 0.6), "angry"),
    # A confident modality against a hedging one.
    (("angry", 0.95), ("happy", 0.18), None, "angry"),
    (("fear", 0.9), None, ("fear", 0.8), "fear"),
    # Text alone is often all there is — camera off, no speech.
    (None, None, ("sad", 0.95), "sad"),
    (None, None, ("happy", 0.9), "happy"),
    # Face alone.
    (("surprise", 0.9), None, None, "surprise"),
    (("disgust", 0.85), None, None, "disgust"),
    # Voice alone.
    (None, ("angry", 0.85), None, "angry"),
    # Nothing at all must not invent an emotion.
    (None, None, None, "neutral"),
]


def run() -> tuple[ClassificationResult, str]:
    y_true, y_pred = [], []
    rows = []
    for face, voice, text, expected in CASES:
        f = _modality(*face) if face else None
        v = _modality(*voice) if voice else None
        t = _modality(*text) if text else None
        fused = es.fuse_emotions(f, v, t)
        y_true.append(expected)
        y_pred.append(fused["emotion"])
        rows.append([
            face[0] if face else "—",
            voice[0] if voice else "—",
            text[0] if text else "—",
            expected,
            fused["emotion"],
            f"{fused['confidence']:.2f}",
            f"{fused['agreement']:.2f}",
            "OK" if fused["emotion"] == expected else "MISS",
        ])

    result = ClassificationResult(
        name="Emotion fusion — decision rule",
        labels=es.EMOTION_LABELS,
        y_true=y_true,
        y_pred=y_pred,
        notes=(
            "Weighted-distribution fusion tested on synthetic modality inputs, "
            "isolating the combination rule from detector accuracy."
        ),
    )
    table = markdown_table(
        rows,
        ["Face", "Voice", "Text", "Expected", "Fused", "Conf.", "Agree", ""],
    )
    return result, table


def confidence_behaviour() -> str:
    """Confidence must fall when modalities disagree — the property that makes
    the number meaningful rather than decorative."""
    agree = es.fuse_emotions(
        _modality("happy", 0.9), _modality("happy", 0.9), _modality("happy", 0.9)
    )
    conflict = es.fuse_emotions(
        _modality("happy", 0.9), _modality("angry", 0.9), _modality("sad", 0.9)
    )
    single = es.fuse_emotions(_modality("happy", 0.9), None, None)
    return markdown_table(
        [
            ["All three agree", f"{agree['confidence']:.3f}", f"{agree['agreement']:.2f}"],
            ["All three disagree", f"{conflict['confidence']:.3f}", f"{conflict['agreement']:.2f}"],
            ["Single modality", f"{single['confidence']:.3f}", f"{single['agreement']:.2f}"],
        ],
        ["Scenario", "Confidence", "Agreement"],
    )


if __name__ == "__main__":
    from evaluation.metrics import render

    result, table = run()
    print(render(result))
    print("**Case detail**\n")
    print(table)
    print("\n**Confidence behaviour**\n")
    print(confidence_behaviour())
