"""Augment FAQ questions with simple Indonesian paraphrase variants.

Goal:
- Add `variasi_pertanyaan` per FAQ item so different user phrasings can match.
- No external dependencies; rule-based + dedupe.

Usage:
  python3 augment_faq_variations.py --input data/faq.json --output data/faq_with_variations.json
  python3 augment_faq_variations.py --inplace

Notes:
- This does NOT change answers.
- Re-run indexing after augmenting: `npm run embed:index:st` or `npm run embed:index:ollama`.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterable


DEFAULT_FIELD = "variasi_pertanyaan"


def _norm_for_dedupe(text: str) -> str:
    s = (text or "").strip().lower()
    s = re.sub(r"[\?\.!,:;\"'()\[\]{}]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _unique_keep_order(items: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for it in items:
        n = _norm_for_dedupe(it)
        if not n:
            continue
        if n in seen:
            continue
        seen.add(n)
        out.append(it.strip())
    return out


def _strip_qmark(q: str) -> str:
    return (q or "").strip().rstrip("?").strip()


def generate_variants(question: str) -> list[str]:
    """Return paraphrase-like variants for a single Indonesian FAQ question.

    This is intentionally conservative: it aims for common rephrasings
    (formal <-> informal, word order changes) without adding new meaning.
    """

    q = (question or "").strip()
    if not q:
        return []

    base = _strip_qmark(q)
    variants: list[str] = []

    # Common typo normalizations (kept as additional variants)
    # e.g. "crome" -> "chrome"
    if re.search(r"\bcrome\b", base, flags=re.IGNORECASE):
        variants.append(re.sub(r"\bcrome\b", "chrome", base, flags=re.IGNORECASE) + "?")

    # Patterns: "Apa fungsi dari ..."
    m = re.match(r"^apa\s+fungsi\s+(?:dari\s+)?(.+)$", base, flags=re.IGNORECASE)
    if m:
        obj = m.group(1).strip()
        variants += [
            f"Fungsi {obj} apa?",
            f"{obj} buat apa?",
            f"{obj} untuk apa?",
            f"Kegunaan {obj} apa?",
            f"{obj} gunanya apa?",
        ]

    # Patterns: "Apa itu ..."
    m = re.match(r"^apa\s+itu\s+(.+)$", base, flags=re.IGNORECASE)
    if m:
        obj = m.group(1).strip()
        variants += [
            f"{obj} itu apa?",
            f"Maksud {obj} apa?",
            f"Apa yang dimaksud dengan {obj}?",
        ]

    # Patterns: "Bagaimana cara ..." / "Gimana cara ..."
    m = re.match(r"^(?:bagaimana|gimana)\s+cara\s+(.+)$", base, flags=re.IGNORECASE)
    if m:
        act = m.group(1).strip()
        variants += [
            f"Gimana cara {act}?",
            f"Cara {act} gimana?",
            f"Cara {act}?",
            f"Bagaimana cara {act}?",
        ]

    # Patterns: "Bagaimana langkah-langkah ..." (keep meaning, change phrasing)
    m = re.match(r"^bagaimana\s+langkah-?langkah\s+(?:untuk\s+)?(.+)$", base, flags=re.IGNORECASE)
    if m:
        act = m.group(1).strip()
        variants += [
            f"Langkah-langkah {act} gimana?",
            f"Gimana langkah-langkah {act}?",
            f"Gimana cara {act}?",
            f"Cara {act} gimana?",
        ]

    # Patterns: "Apa langkah pertama ..."
    m = re.match(r"^apa\s+langkah\s+pertama\s+(?:untuk\s+)?(.+)$", base, flags=re.IGNORECASE)
    if m:
        act = m.group(1).strip()
        variants += [
            f"Langkah awal untuk {act} apa?",
            f"Step pertama untuk {act} apa?",
            f"Pertama kali harus ngapain untuk {act}?",
        ]

    # Patterns: "Informasi apa saja ..."
    m = re.match(r"^informasi\s+apa\s+saja\s+(.+)$", base, flags=re.IGNORECASE)
    if m:
        rest = m.group(1).strip()
        variants += [
            f"{rest} itu menampilkan informasi apa saja?",
            f"Apa saja informasi yang ditampilkan {rest}?",
            f"Info apa aja {rest}?",
        ]

    # Patterns: "Apa saja ..."
    m = re.match(r"^apa\s+saja\s+(.+)$", base, flags=re.IGNORECASE)
    if m and "informasi" not in base.lower():
        rest = m.group(1).strip()
        variants += [
            f"{rest} apa saja?",
            f"Apa aja {rest}?",
        ]

    # Patterns: "Tidak bisa ..." / "Tidak keluar ..." / "Tidak muncul ..." / "Tidak dapat ..."
    m = re.match(r"^(tidak\s+(?:bisa|keluar|muncul|dapat)\s+.+)$", base, flags=re.IGNORECASE)
    if m:
        stmt = m.group(1).strip()
        variants += [
            f"Kenapa {stmt}?",
            re.sub(r"^tidak\s+bisa\b", "gak bisa", stmt, flags=re.IGNORECASE) + "?",
            re.sub(r"^tidak\s+dapat\b", "gak bisa", stmt, flags=re.IGNORECASE) + "?",
            re.sub(r"^tidak\s+keluar\b", "gak keluar", stmt, flags=re.IGNORECASE) + "?",
            re.sub(r"^tidak\s+muncul\b", "gak muncul", stmt, flags=re.IGNORECASE) + "?",
        ]

    # If it's not phrased as a question, add a minimal troubleshooting wrapper.
    if not re.search(r"\b(apa|bagaimana|gimana|kenapa|mengapa|kapan|dimana|di mana|berapa)\b", base, flags=re.IGNORECASE):
        variants += [
            f"Kenapa {base}?",
            f"Cara mengatasi {base}?",
            f"Gimana cara mengatasi {base}?",
        ]

    # Light formal <-> informal swap if present
    if re.search(r"\bbagaimana\b", base, flags=re.IGNORECASE):
        variants.append(re.sub(r"\bbagaimana\b", "gimana", base, flags=re.IGNORECASE) + "?")
    if re.search(r"\bgimana\b", base, flags=re.IGNORECASE):
        variants.append(re.sub(r"\bgimana\b", "bagaimana", base, flags=re.IGNORECASE) + "?")

    # Ensure they look like questions.
    variants = [v if v.strip().endswith("?") else (v.strip() + "?") for v in variants]
    return _unique_keep_order(variants)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input", default="data/faq.json")
    p.add_argument("--output", default="data/faq_with_variations.json")
    p.add_argument("--field", default=DEFAULT_FIELD)
    p.add_argument("--max-per-question", type=int, default=6)
    p.add_argument("--inplace", action="store_true", help="Overwrite --input file")
    args = p.parse_args()

    in_path = Path(args.input)
    out_path = in_path if args.inplace else Path(args.output)

    data: Any
    data = json.loads(in_path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit("Invalid FAQ JSON: root is not a list")

    total_items = 0
    total_added = 0
    for cat in data:
        faq = cat.get("faq")
        if not isinstance(faq, list):
            continue
        for item in faq:
            total_items += 1
            q = str(item.get("pertanyaan") or "").strip()
            if not q:
                continue

            existing = item.get(args.field)
            existing_list = existing if isinstance(existing, list) else []

            new_vars = generate_variants(q)
            merged = _unique_keep_order([*existing_list, *new_vars])

            # Drop original question if it somehow appears in variations
            q_norm = _norm_for_dedupe(q)
            merged = [v for v in merged if _norm_for_dedupe(v) != q_norm]

            if args.max_per_question > 0:
                merged = merged[: args.max_per_question]

            if merged:
                before = len(existing_list)
                item[args.field] = merged
                total_added += max(0, len(merged) - before)
            elif args.field in item:
                # Keep file tidy: remove empty field
                item.pop(args.field, None)

    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "input": str(in_path),
                "output": str(out_path),
                "field": args.field,
                "total_items": total_items,
                "total_added_variants": total_added,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
