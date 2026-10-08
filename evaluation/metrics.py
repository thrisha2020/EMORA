"""Shared metrics and report formatting.

The synopsis (§5.5) asks for accuracy, precision, recall and F1, so every
classifier evaluation reports the same four plus a confusion matrix. Macro
averaging is used throughout: it weights every emotion class equally, which
matters because test sets for this task are almost never balanced and a
sample-weighted average would flatter a model that only does well on `neutral`.
"""

from dataclasses import dataclass, field
from typing import Sequence


@dataclass
class ClassificationResult:
    name: str
    labels: list[str]
    y_true: list[str]
    y_pred: list[str]
    notes: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.y_true)

    def scores(self) -> dict:
        from sklearn.metrics import (
            accuracy_score,
            confusion_matrix,
            precision_recall_fscore_support,
        )

        if not self.y_true:
            return {}
        present = [l for l in self.labels if l in set(self.y_true) | set(self.y_pred)]
        precision, recall, f1, support = precision_recall_fscore_support(
            self.y_true, self.y_pred, labels=present, zero_division=0
        )
        macro_p, macro_r, macro_f1, _ = precision_recall_fscore_support(
            self.y_true, self.y_pred, labels=present, average="macro", zero_division=0
        )
        return {
            "accuracy": accuracy_score(self.y_true, self.y_pred),
            "macro_precision": macro_p,
            "macro_recall": macro_r,
            "macro_f1": macro_f1,
            "per_class": {
                label: {
                    "precision": float(precision[i]),
                    "recall": float(recall[i]),
                    "f1": float(f1[i]),
                    "support": int(support[i]),
                }
                for i, label in enumerate(present)
            },
            "labels": present,
            "confusion_matrix": confusion_matrix(
                self.y_true, self.y_pred, labels=present
            ).tolist(),
        }


def markdown_table(rows: Sequence[Sequence[str]], header: Sequence[str]) -> str:
    out = ["| " + " | ".join(header) + " |",
           "|" + "|".join("---" for _ in header) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(out)


def render(result: ClassificationResult) -> str:
    """A report-ready section: summary, per-class table, confusion matrix."""
    s = result.scores()
    if not s:
        return f"### {result.name}\n\n_No samples evaluated._\n"

    lines = [f"### {result.name}", ""]
    if result.notes:
        lines += [f"_{result.notes}_", ""]
    lines += [
        f"- Samples: **{result.n}**",
        f"- Accuracy: **{s['accuracy']:.3f}**",
        f"- Macro precision: **{s['macro_precision']:.3f}**",
        f"- Macro recall: **{s['macro_recall']:.3f}**",
        f"- Macro F1: **{s['macro_f1']:.3f}**",
        "",
        "**Per class**",
        "",
        markdown_table(
            [
                [
                    label,
                    f"{v['precision']:.3f}",
                    f"{v['recall']:.3f}",
                    f"{v['f1']:.3f}",
                    v["support"],
                ]
                for label, v in s["per_class"].items()
            ],
            ["Class", "Precision", "Recall", "F1", "Support"],
        ),
        "",
        "**Confusion matrix** (rows = actual, columns = predicted)",
        "",
        markdown_table(
            [
                [s["labels"][i]] + [str(c) for c in row]
                for i, row in enumerate(s["confusion_matrix"])
            ],
            [""] + s["labels"],
        ),
        "",
    ]
    return "\n".join(lines)
