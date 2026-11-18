"""Каждый файл в public/ где-то используется: иначе это мусор, который отдаётся всем по прямой ссылке."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = [p for d in ("src", "e2e") for p in (ROOT / d).rglob("*") if p.is_file()] + [ROOT / "next.config.ts"]


def test_public_files_are_referenced():
    text = "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in SOURCES)
    public = ROOT / "public"
    unused = [str(p.relative_to(public)) for p in public.rglob("*") if p.is_file() and str(p.relative_to(public)) not in text]
    assert unused == [], f"не используются: {unused}"
