"""Chatbot evaluation (synopsis §5.4 — "response relevance and correctness").

Each case pairs a user message and a detected emotion with what an appropriate
reply must and must not do. Scoring is rule-based rather than model-judged: it
needs no extra API spend, is deterministic, and the criteria are auditable in an
exam — an examiner can read exactly why a response scored what it did.

Runs against a scratch profile with no stored memories. The first version used
the real enrolled user, whose saved preference ("User prefers Marathi language")
made every reply Marathi — so the English tone patterns matched nothing and all
six cases passed vacuously. A shared evaluation must not inherit one user's
personalisation.

Requires a configured provider, since it exercises the real chat path.
"""

import re

from evaluation.metrics import markdown_table

# (message, emotion, must_avoid, description)
CASES = [
    (
        "I failed my exam and I feel awful.",
        "sad",
        [r"\bgreat\b", r"\bawesome\b", r"congratulat"],
        "Sad user — must not respond cheerfully",
    ),
    (
        "I got the job! I can't believe it!",
        "happy",
        [r"sorry to hear", r"that.s (unfortunate|tough)"],
        "Happy user — must not commiserate",
    ),
    (
        "This is the third time your reminder failed. I'm furious.",
        "angry",
        [r"calm down", r"you.re overreacting"],
        "Angry user — must not dismiss the feeling",
    ),
    (
        "What time is my meeting?",
        "neutral",
        [r"i sense", r"you (seem|appear) "],
        "Neutral factual query — must not narrate emotion detection",
    ),
    (
        "I'm scared about the presentation tomorrow.",
        "fear",
        [r"nothing to worry", r"don.t be (silly|scared)"],
        "Anxious user — must not dismiss",
    ),
    (
        "Remind me to drink water every hour.",
        "neutral",
        [r"i sense", r"emotion"],
        "Task request — must act, not analyse mood",
    ),
]

MAX_SENTENCES_SPOKEN = 6  # replies are read aloud; long answers are a real defect

# No memory file exists for this id, so get_reply() sees an empty profile.
EVAL_USER_ID = -1


def run() -> tuple[list[dict], str]:
    from backend.app.database import SessionLocal
    from backend.app.services.chat_service import get_reply
    from backend.app.services.llm_service import LLMError

    db = SessionLocal()
    try:

        rows, scored = [], []
        for message, emotion, must_avoid, description in CASES:
            try:
                reply = get_reply(
                    db,
                    user_id=EVAL_USER_ID,
                    user_message=message,
                    user_name="Test User",
                    emotion_context=f"They seem {emotion}.",
                )
            except LLMError as e:
                return [], f"_No provider configured: {e}_\n"
            except Exception as e:
                return [], f"_Provider error: {str(e)[:150]}_\n"

            lowered = (reply or "").lower()
            violations = [p for p in must_avoid if re.search(p, lowered)]
            sentences = len([s for s in re.split(r"[.!?]+", reply or "") if s.strip()])

            # Guard against the vacuous-pass trap: if the reply is not mostly
            # latin script, the English tone patterns below prove nothing.
            letters = [c for c in (reply or "") if c.isalpha()]
            mostly_latin = (
                sum(1 for c in letters if c.isascii()) / len(letters) > 0.8
                if letters
                else False
            )

            checks = {
                "non_empty": bool(reply and reply.strip()),
                "checkable_language": mostly_latin,
                "tone_appropriate": not violations,
                "concise_for_speech": sentences <= MAX_SENTENCES_SPOKEN,
                "no_markup": not re.search(r"[*_#`]|<think>", reply or ""),
            }
            passed = all(checks.values())
            scored.append({"description": description, "checks": checks, "reply": reply})
            rows.append([
                description,
                "PASS" if passed else "FAIL",
                sentences,
                ", ".join(k for k, v in checks.items() if not v) or "—",
                (reply or "")[:70].replace("\n", " "),
            ])

        table = markdown_table(
            rows, ["Scenario", "Result", "Sentences", "Failed checks", "Reply (truncated)"]
        )
        passes = sum(1 for s in scored if all(s["checks"].values()))
        summary = "\n".join([
            "### Chatbot — response relevance and correctness",
            "",
            "_Rule-based scoring: tone appropriate to the detected emotion, no "
            "narration of the emotion pipeline, concise enough to be spoken, and "
            "free of markup or leaked reasoning._",
            "",
            f"- Scenarios: **{len(rows)}**",
            f"- Passed: **{passes}/{len(rows)}** (**{passes / len(rows):.1%}**)",
            "",
            table,
            "",
        ])
        return scored, summary
    finally:
        db.close()


if __name__ == "__main__":
    _, summary = run()
    print(summary)
