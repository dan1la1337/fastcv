"""Замер точности ИИ: как считаются поля — без сети."""

from types import SimpleNamespace

import eval_ai


def answer(**fields):
    base = {f: None for f in eval_ai.FIELDS} | {"is_job": True}
    base.update(fields)
    return SimpleNamespace(model_dump=lambda: base)


def test_score_counts_only_labelled_fields_and_not_jobs_by_is_job():
    cases = [
        {"source": "a/1", "text": "a", "expected": {"is_job": True, "city": "Москва", "level": "junior"}},
        {"source": "b/1", "text": "b", "expected": {"is_job": False, "city": "Москва"}},
        {"source": "c/1", "text": "c", "expected": {"is_job": True, "salary_min": 100000}},
    ]
    answers = {"a": answer(city="москва", level="middle"), "b": answer(is_job=False), "c": answer(salary_min=100000)}
    result = eval_ai.score(cases, lambda text: answers[text])
    assert result["accuracy"] == {"is_job": 1.0, "salary_min": 1.0, "city": 1.0, "level": 0.0}
    assert result["mistakes"] == [{"source": "a/1", "field": "level", "expected": "junior", "got": "middle"}]


def test_ai_failure_is_counted():
    def broken(text):
        raise RuntimeError("down")
    result = eval_ai.score([{"source": "a/1", "text": "a", "expected": {"is_job": True}}], broken)
    assert result["ai_failed"] == 1 and result["accuracy"] == {}
