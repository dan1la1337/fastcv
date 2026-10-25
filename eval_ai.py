"""Замер точности ИИ на эталонном наборе (план, 1.3).

Посты и правильные ответы лежат в таблице ai_golden (не в репозитории). Скрипт прогоняет
каждый размеченный пост через тот же нормализатор, что и сборщик, и считает долю верных
ответов по каждому полю. Итог — в выводе и в app_settings.ai_eval_last.
Запуск: GitHub → Actions → AI eval → Run workflow (можно указать другие модели).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Callable

FIELDS = ("is_job", "salary_min", "salary_max", "salary_currency", "city", "level", "direction", "work_format")


def same(field: str, expected: Any, got: Any) -> bool:
    if field == "city":
        norm = lambda v: (v or "").strip().lower().replace("ё", "е") or None  # noqa: E731
        return norm(expected) == norm(got)
    return expected == got


def score(cases: list[dict], normalize: Callable[[str], Any]) -> dict:
    """cases: [{source, text, expected}]. Поля сверяем только те, что есть в разметке;
    для «не вакансий» — только is_job."""
    totals = {f: [0, 0] for f in FIELDS}
    mistakes: list[dict] = []
    failed = 0
    for case in cases:
        expected = case["expected"]
        try:
            got = normalize(case["text"]).model_dump()
        except Exception as e:  # ИИ не ответил — пост считаем ошибкой по всем полям
            failed += 1
            mistakes.append({"source": case["source"], "field": "*", "error": type(e).__name__})
            continue
        fields = FIELDS if expected.get("is_job") and got.get("is_job") else ("is_job",)
        for field in fields:
            if field not in expected:
                continue
            totals[field][1] += 1
            if same(field, expected[field], got.get(field)):
                totals[field][0] += 1
            else:
                mistakes.append({"source": case["source"], "field": field,
                                 "expected": expected[field], "got": got.get(field)})
    accuracy = {f: round(ok / n, 3) for f, (ok, n) in totals.items() if n}
    return {"cases": len(cases), "ai_failed": failed, "accuracy": accuracy,
            "counts": {f: n for f, (_, n) in totals.items() if n}, "mistakes": mistakes}


def main() -> None:
    from main import GEMINI_MODELS, make_gemini_normalizer
    from supabase import create_client

    db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    models = tuple(m.strip() for m in (os.getenv("GEMINI_MODELS") or "").split(",") if m.strip()) or GEMINI_MODELS
    rows = (db.table("ai_golden").select("source, text, expected")
            .not_.is_("expected", "null").order("id").execute().data or [])
    result = score(rows, make_gemini_normalizer(os.environ["GEMINI_API_KEY"], models))
    result["models"] = list(models)
    result["at"] = datetime.now(timezone.utc).isoformat()
    print(f"Постов: {result['cases']}, ИИ не ответил: {result['ai_failed']}")
    for field, value in result["accuracy"].items():
        print(f"  {field:<16} {value * 100:5.1f}%  ({result['counts'][field]})")
    for m in result["mistakes"]:
        print("  ✗", json.dumps(m, ensure_ascii=False))
    db.table("app_settings").upsert({"key": "ai_eval_last", "value": json.dumps(result, ensure_ascii=False),
                                     "updated_at": result["at"]}).execute()


if __name__ == "__main__":
    main()
