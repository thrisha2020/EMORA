"""Text-emotion evaluation (synopsis §5.4, §5.5).

Also runs the lexicon fallback over the same samples, which gives the
comparative analysis §5.5 asks for: the transformer against the heuristic it
replaced, on identical data.
"""

import numpy as np

from backend.app.services import emotion_service as es
from evaluation.data.text_emotion import load
from evaluation.metrics import ClassificationResult


def _lexicon_predict(text: str) -> str:
    vec = es._lexicon_emotion(text)
    return es.EMOTION_LABELS[int(np.argmax(vec))]


def run() -> list[ClassificationResult]:
    texts, labels = load()
    results = []

    # The model actually shipped.
    pipe = es._load_text_pipe()
    if pipe is not None:
        preds = []
        for t in texts:
            r = es.analyze_text_sentiment(t)
            preds.append(r["emotion"] if r else "neutral")
        results.append(
            ClassificationResult(
                name="Text emotion — DistilRoBERTa (deployed)",
                labels=es.EMOTION_LABELS,
                y_true=labels,
                y_pred=preds,
                notes=(
                    "j-hartmann/emotion-english-distilroberta-base, the classifier "
                    "used in production. 70 hand-authored assistant-style sentences."
                ),
            )
        )

    # The fallback, for comparison.
    results.append(
        ClassificationResult(
            name="Text emotion — lexicon baseline (fallback)",
            labels=es.EMOTION_LABELS,
            y_true=labels,
            y_pred=[_lexicon_predict(t) for t in texts],
            notes=(
                "Keyword-matching fallback used when the transformer is "
                "unavailable. Included as the §5.5 comparison baseline."
            ),
        )
    )
    return results


if __name__ == "__main__":
    from evaluation.metrics import render

    for r in run():
        print(render(r))
