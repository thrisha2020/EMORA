"""Emotion fusion, smoothing and label-mapping behaviour.

These exercise the pure logic only — no model downloads — so they run fast in CI.
"""

import numpy as np
import pytest

from backend.app.services import emotion_service as es


def vec(**scores) -> dict:
    """Build a modality result from partial scores, filling the rest with zeros."""
    full = {label: 0.0 for label in es.EMOTION_LABELS}
    full.update(scores)
    total = sum(full.values()) or 1.0
    full = {k: v / total for k, v in full.items()}
    top = max(full, key=full.get)
    return {"emotion": top, "confidence": full[top], "scores": full, "source": "test"}


class TestFusion:
    def test_no_modalities_is_neutral_with_zero_confidence(self):
        result = es.fuse_emotions(None, None, None)
        assert result["emotion"] == "neutral"
        assert result["confidence"] == 0.0
        assert result["sources"] == []

    def test_single_modality_passes_through(self):
        result = es.fuse_emotions(vec(happy=0.9, neutral=0.1), None, None)
        assert result["emotion"] == "happy"
        assert result["sources"] == ["face"]

    def test_agreeing_modalities_beat_a_disagreeing_one(self):
        result = es.fuse_emotions(
            vec(sad=0.85, neutral=0.15),
            vec(sad=0.80, neutral=0.20),
            vec(happy=0.70, neutral=0.30),
        )
        assert result["emotion"] == "sad"
        assert result["agreement"] == pytest.approx(2 / 3)

    def test_full_agreement_scores_higher_than_conflict(self):
        agree = es.fuse_emotions(
            vec(happy=0.9, neutral=0.1), vec(happy=0.9, neutral=0.1), vec(happy=0.9, neutral=0.1)
        )
        conflict = es.fuse_emotions(
            vec(happy=0.9, neutral=0.1), vec(angry=0.9, neutral=0.1), vec(sad=0.9, neutral=0.1)
        )
        assert agree["agreement"] == 1.0
        assert agree["confidence"] > conflict["confidence"]

    def test_hedging_modality_counts_less_than_confident_one(self):
        """A near-flat distribution should not outvote a peaked one."""
        confident = vec(angry=0.95, neutral=0.05)
        hedging = {
            "emotion": "happy",
            "confidence": 0.16,
            "scores": {l: 1 / 7 for l in es.EMOTION_LABELS} | {"happy": 0.16},
            "source": "test",
        }
        result = es.fuse_emotions(confident, hedging, None)
        assert result["emotion"] == "angry"

    def test_scores_form_a_distribution(self):
        result = es.fuse_emotions(vec(fear=0.6, sad=0.4), vec(sad=0.7, fear=0.3), None)
        assert sum(result["scores"].values()) == pytest.approx(1.0)
        assert all(0.0 <= v <= 1.0 for v in result["scores"].values())

    def test_confidence_never_exceeds_one(self):
        result = es.fuse_emotions(
            vec(happy=1.0), vec(happy=1.0), vec(happy=1.0)
        )
        assert 0.0 <= result["confidence"] <= 1.0


class TestSmoothing:
    def setup_method(self):
        es.clear_history(999)

    def test_first_reading_passes_through(self):
        result = es.smooth(999, vec(happy=0.9, neutral=0.1))
        assert result["emotion"] == "happy"

    def test_single_outlier_does_not_flip_the_label(self):
        """The flicker case the old majority-vote smoother still let through."""
        for _ in range(4):
            es.smooth(999, vec(neutral=0.9, happy=0.1))
        result = es.smooth(999, vec(angry=0.95, neutral=0.05))
        assert result["emotion"] == "neutral"
        assert result["raw_emotion"] == "angry"

    def test_sustained_change_does_shift_the_label(self):
        for _ in range(4):
            es.smooth(999, vec(neutral=0.9, happy=0.1))
        for _ in range(4):
            result = es.smooth(999, vec(sad=0.95, neutral=0.05))
        assert result["emotion"] == "sad"

    def test_users_do_not_share_state(self):
        es.clear_history(1000)
        for _ in range(5):
            es.smooth(999, vec(happy=0.95))
        result = es.smooth(1000, vec(sad=0.95))
        assert result["emotion"] == "sad"
        es.clear_history(1000)


class TestLabelMapping:
    def test_checkpoint_aliases_fold_into_canonical_labels(self):
        # superb/...-superb-er emits ang/neu/hap/sad; ehcalabres emits fearful/surprised.
        mapped = es._vec_from_scores({"ang": 0.7, "neu": 0.2, "hap": 0.1})
        assert es.EMOTION_LABELS[int(np.argmax(mapped))] == "angry"

        mapped = es._vec_from_scores({"fearful": 0.8, "surprised": 0.2})
        assert es.EMOTION_LABELS[int(np.argmax(mapped))] == "fear"

        # DistilRoBERTa emits joy/anger/sadness.
        mapped = es._vec_from_scores({"joy": 0.9, "sadness": 0.1})
        assert es.EMOTION_LABELS[int(np.argmax(mapped))] == "happy"

    def test_unknown_labels_are_ignored_not_crashed(self):
        mapped = es._vec_from_scores({"nonsense": 0.9, "happy": 0.1})
        assert es.EMOTION_LABELS[int(np.argmax(mapped))] == "happy"

    def test_all_unknown_labels_yield_uniform(self):
        mapped = es._vec_from_scores({"xxx": 1.0})
        assert mapped == pytest.approx(np.full(7, 1 / 7))


class TestTextFallback:
    def test_lexicon_detects_polarity_without_a_model(self):
        assert es._lexicon_emotion("this is wonderful and I am grateful").argmax() == es._IDX["happy"]
        assert es._lexicon_emotion("I feel hopeless and exhausted").argmax() == es._IDX["sad"]
        assert es._lexicon_emotion("this is infuriating").argmax() == es._IDX["angry"]

    def test_empty_text_returns_none(self):
        assert es.analyze_text_sentiment("") is None
        assert es.analyze_text_sentiment("   ") is None
