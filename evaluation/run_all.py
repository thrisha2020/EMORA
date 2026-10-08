"""Run every evaluation and write a report-ready document.

Covers synopsis §5.4 (Model Evaluation) and §5.5 (Comparative Analysis).

    python -m evaluation.run_all              # everything available
    python -m evaluation.run_all --skip-chat  # no provider spend
    python -m evaluation.run_all --skip-stt   # skip the slow TTS synthesis

Output: evaluation/results/evaluation_report.md — paste straight into the report.
"""

import argparse
import datetime
import os

from evaluation.metrics import markdown_table, render

RESULTS_DIR = "evaluation/results"
OUT = os.path.join(RESULTS_DIR, "evaluation_report.md")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-chat", action="store_true", help="skip provider-billed chat eval")
    ap.add_argument("--skip-stt", action="store_true", help="skip TTS synthesis (slow)")
    args = ap.parse_args()

    os.makedirs(RESULTS_DIR, exist_ok=True)
    sections: list[str] = []
    summary_rows: list[list[str]] = []

    def record(name: str, result) -> None:
        s = result.scores()
        if s:
            summary_rows.append([
                name,
                str(result.n),
                f"{s['accuracy']:.3f}",
                f"{s['macro_precision']:.3f}",
                f"{s['macro_recall']:.3f}",
                f"{s['macro_f1']:.3f}",
            ])

    print("→ text emotion")
    from evaluation import eval_text_emotion

    for r in eval_text_emotion.run():
        sections.append(render(r))
        record(r.name, r)

    print("→ emotion fusion")
    from evaluation import eval_fusion

    fusion_result, case_table = eval_fusion.run()
    sections.append(render(fusion_result))
    sections.append("**Case detail**\n\n" + case_table + "\n")
    sections.append("**Confidence behaviour**\n\n" + eval_fusion.confidence_behaviour() + "\n")
    record(fusion_result.name, fusion_result)

    print("→ facial emotion")
    from evaluation import eval_face_emotion

    face_emotion, message = eval_face_emotion.run()
    if face_emotion:
        sections.append(render(face_emotion))
        record(face_emotion.name, face_emotion)
    else:
        sections.append("### Facial emotion — DeepFace\n\n" + message)

    print("→ speech emotion")
    from evaluation import eval_voice_emotion

    voice_results, message = eval_voice_emotion.run()
    if voice_results:
        for r in voice_results:
            sections.append(render(r))
            record(r.name, r)
    else:
        sections.append("### Speech emotion — wav2vec2\n\n" + message)

    print("→ face recognition")
    from evaluation import eval_face_recognition

    ident, extra = eval_face_recognition.identification()
    if ident:
        sections.append(render(ident))
        record(ident.name, ident)
    sections.append(extra)
    sections.append(eval_face_recognition.separability())

    if not args.skip_stt:
        print("→ speech-to-text (synthesising audio, this is slow)")
        from evaluation import eval_stt

        sections.append(eval_stt.render(eval_stt.run()))
    else:
        sections.append("### Speech-to-text\n\n_Skipped (--skip-stt)._\n")

    if not args.skip_chat:
        print("→ chatbot")
        from evaluation import eval_chatbot

        _, chat_summary = eval_chatbot.run()
        sections.append(chat_summary)
    else:
        sections.append("### Chatbot\n\n_Skipped (--skip-chat)._\n")

    header = "\n".join([
        "# Model Evaluation and Comparative Analysis",
        "",
        "_Emotion-Aware Intelligent Virtual Assistant — synopsis §5.4 and §5.5._",
        "",
        f"Generated: {datetime.datetime.now():%d %B %Y, %H:%M}",
        "",
        "All figures are produced by `python -m evaluation.run_all` and are "
        "reproducible on the project machine. Macro averaging is used throughout, "
        "so every emotion class counts equally regardless of how many samples it has.",
        "",
        "## Summary",
        "",
        markdown_table(
            summary_rows,
            ["Module", "n", "Accuracy", "Macro precision", "Macro recall", "Macro F1"],
        )
        if summary_rows
        else "_No classifier results._",
        "",
        "---",
        "",
    ])

    with open(OUT, "w") as f:
        f.write(header + "\n".join(sections))
    print(f"\nWritten: {OUT}")
    print(markdown_table(
        summary_rows,
        ["Module", "n", "Acc", "Prec", "Rec", "F1"],
    ))


if __name__ == "__main__":
    main()
