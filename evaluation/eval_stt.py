"""Speech-to-text evaluation (synopsis §5.4 — "word recognition accuracy").

Ground truth is generated with edge-tts, which is already a project dependency:
a known sentence is synthesised, transcribed, and the two compared. That makes
the test fully reproducible with no dataset download.

Caveat to state in the report: synthesised speech is cleaner than a real user in
a real room, so this is an upper bound. It measures the transcription pipeline
(decode -> resample -> model), not microphone or accent robustness. Note the
`--noise` option, which mixes in gaussian noise to probe degradation.
"""

import asyncio
import re
import subprocess
import tempfile
from dataclasses import dataclass

import numpy as np

SENTENCES = [
    "set a reminder for tomorrow morning at nine",
    "how am I feeling today",
    "open the project folder on my desktop",
    "what is the weather going to be like this evening",
    "play some relaxing music please",
    "remind me to drink water every hour",
    "show me my mood for the last seven days",
    "create a file called notes dot text",
    "I have been feeling quite stressed this week",
    "what did we talk about yesterday",
    "cancel the reminder I set earlier",
    "how many reminders do I have pending",
]


@dataclass
class WERResult:
    reference: str
    hypothesis: str
    errors: int
    words: int

    @property
    def wer(self) -> float:
        return self.errors / self.words if self.words else 0.0


def _normalise(text: str) -> list[str]:
    """Lowercase, strip punctuation, collapse whitespace, spell out digits.

    Without this, "9" vs "nine" counts as an error even though the transcription
    is correct — a formatting difference, not a recognition failure.
    """
    digits = {
        "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
        "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
    }
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    words = []
    for w in text.split():
        words.extend(digits[c] for c in w) if w.isdigit() else words.append(w)
    return words


def _edit_distance(ref: list[str], hyp: list[str]) -> int:
    """Levenshtein at word level — the standard WER numerator."""
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i]
        for j, h in enumerate(hyp, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h)))
        prev = cur
    return prev[-1]


async def _synthesise(text: str, path: str) -> bool:
    try:
        import edge_tts

        await edge_tts.Communicate(text, "en-US-AriaNeural").save(path)
        return True
    except Exception as e:
        print(f"  [tts failed] {e}")
        return False


def _add_noise(src: str, dst: str, snr_db: float) -> bool:
    """Mix gaussian noise at a target signal-to-noise ratio."""
    try:
        raw = subprocess.run(
            ["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"],
            capture_output=True, check=True,
        ).stdout
        y = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
        power = np.mean(y**2)
        noise = np.random.normal(0, np.sqrt(power / (10 ** (snr_db / 10))), len(y))
        mixed = np.clip(y + noise, -1, 1).astype(np.float32)
        subprocess.run(
            ["ffmpeg", "-y", "-f", "f32le", "-ar", "16000", "-ac", "1", "-i", "pipe:0", dst],
            input=mixed.tobytes(), capture_output=True, check=True,
        )
        return True
    except Exception:
        return False


def run(noise_snr_db: float | None = None) -> dict:
    from backend.app.services.stt_service import transcribe

    results: list[WERResult] = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, sentence in enumerate(SENTENCES):
            path = f"{tmp}/s{i}.mp3"
            if not asyncio.run(_synthesise(sentence, path)):
                continue
            if noise_snr_db is not None:
                noisy = f"{tmp}/s{i}_noisy.wav"
                if _add_noise(path, noisy, noise_snr_db):
                    path = noisy
            with open(path, "rb") as f:
                hypothesis = transcribe(f.read())["text"]

            ref, hyp = _normalise(sentence), _normalise(hypothesis)
            results.append(WERResult(sentence, hypothesis, _edit_distance(ref, hyp), len(ref)))

    total_errors = sum(r.errors for r in results)
    total_words = sum(r.words for r in results)
    return {
        "results": results,
        "wer": total_errors / total_words if total_words else 0.0,
        "word_accuracy": 1 - (total_errors / total_words) if total_words else 0.0,
        "sentences": len(results),
        "words": total_words,
        "exact_matches": sum(1 for r in results if r.errors == 0),
        "noise_snr_db": noise_snr_db,
    }


def render(summary: dict) -> str:
    from evaluation.metrics import markdown_table

    cond = (
        "clean synthesised speech"
        if summary["noise_snr_db"] is None
        else f"noise added at {summary['noise_snr_db']} dB SNR"
    )
    lines = [
        f"### Speech-to-text — {cond}",
        "",
        "_Parakeet-TDT with Whisper fallback. Reference audio synthesised with "
        "edge-tts, so this is an upper bound: cleaner than a real room._",
        "",
        f"- Sentences: **{summary['sentences']}**  ·  Words: **{summary['words']}**",
        f"- Word Error Rate (WER): **{summary['wer']:.3f}**",
        f"- Word accuracy: **{summary['word_accuracy']:.3f}**",
        f"- Exact sentence matches: **{summary['exact_matches']}/{summary['sentences']}**",
        "",
        markdown_table(
            [
                [r.reference, r.hypothesis or "_(empty)_", r.errors, r.words]
                for r in summary["results"]
            ],
            ["Reference", "Transcription", "Errors", "Words"],
        ),
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    print(render(run()))
