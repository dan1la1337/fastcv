"""Надёжность сборщика: таймауты Gemini, повторы запросов к API, User-Agent."""

import httpx2
import pytest
import requests

import http_retry
import main
import superjob
import trudvsem
from test_scraper import MODELS, FakeStore, _Batcher, _fake_gemini, _feeds, job


def _timeout():
    return httpx2.ReadTimeout("The read operation timed out")


# --- Gemini: таймаут на пачке ---------------------------------------------------


def test_gemini_read_timeout_is_retried_on_next_model(monkeypatch):
    """google-genai 3.x бросает httpx2.ReadTimeout: это повод для повтора, а не падение запуска."""
    calls = _fake_gemini(monkeypatch, [_timeout(), _timeout(), job()])
    normalize = main.make_gemini_normalizer("key", MODELS)
    assert normalize("текст").title == "Python Developer"
    assert calls["models"] == ["model-a", "model-a", "model-b"]
    assert normalize.stats["errors"] == {"model-a: ReadTimeout": 2}


def test_gemini_timeouts_everywhere_become_ai_unavailable(monkeypatch):
    _fake_gemini(monkeypatch, [_timeout()] * (main.AI_ATTEMPTS * len(MODELS)))
    with pytest.raises(main.AIUnavailable):
        main.make_gemini_normalizer("key", MODELS).many(["пост a", "пост b"])


def test_gemini_backs_off_between_attempts(monkeypatch):
    _fake_gemini(monkeypatch, [_timeout(), job()])
    pauses = []
    monkeypatch.setattr(main.time, "sleep", pauses.append)
    main.make_gemini_normalizer("key", MODELS)("текст")
    assert pauses == [main.AI_PAUSE_SECONDS]


class _FailingBatches(_Batcher):
    """Пачки с номерами из failing падают с exc, остальные разбираются."""

    def __init__(self, failing: set[int], exc: Exception):
        super().__init__()
        self.failing, self.exc, self.calls = failing, exc, 0

    def many(self, texts):
        self.calls += 1
        if self.calls in self.failing:
            raise self.exc
        return super().many(texts)


@pytest.mark.parametrize("exc", [main.AIUnavailable("ReadTimeout"), _timeout()])
def test_failed_batch_is_skipped_and_run_continues(monkeypatch, exc):
    monkeypatch.setattr(main, "AI_BATCH", 2)
    monkeypatch.setattr(main, "AI_PARALLEL", 1)
    rows = [{"username": "a", "last_post_id": 10, "history_before": 0},
            {"username": "b", "last_post_id": 20, "history_before": 0}]
    store = FakeStore(rows=rows)
    ai = _FailingBatches({1}, exc)
    summary = main.run_batched(store, ai, rows, fetch=_feeds({"a": [11, 12], "b": [21, 22]}), pause=lambda s: None)
    # первая пачка (канал a) пропущена, вторая (канал b) сохранена
    assert ai.calls == 2 and summary.saved == 2
    assert store.channel_updates["a"]["last_post_id"] == 10    # посты a — в следующий запуск
    assert store.channel_updates["b"]["last_post_id"] == 22
    assert summary.results[0].ai_stopped and not summary.results[1].ai_stopped


def test_batches_stop_after_consecutive_failures(monkeypatch):
    monkeypatch.setattr(main, "AI_BATCH", 1)
    monkeypatch.setattr(main, "AI_PARALLEL", 1)
    rows = [{"username": "a", "last_post_id": 10, "history_before": 0}]
    store = FakeStore(rows=rows)
    ai = _FailingBatches(set(range(1, 100)), main.AIUnavailable("ReadTimeout"))
    main.run_batched(store, ai, rows, fetch=_feeds({"a": list(range(11, 21))}), pause=lambda s: None)
    assert ai.calls == main.AI_CIRCUIT_BREAKER


# --- повторы запросов к «Работе России» и SuperJob -------------------------------


class _Resp:
    def __init__(self, status: int, data: dict | None = None):
        self.status_code, self._data = status, data or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}", response=self)

    def json(self):
        return self._data


def _scripted(outcomes):
    calls = []

    def get(url, **kwargs):
        calls.append(url)
        item = outcomes[len(calls) - 1]
        if isinstance(item, Exception):
            raise item
        return item
    return get, calls


def test_retry_repeats_timeouts_and_server_errors(monkeypatch):
    get, calls = _scripted([requests.ReadTimeout("slow"), _Resp(503), _Resp(200, {"ok": 1})])
    pauses = []
    assert http_retry.get(get, "u", sleep=pauses.append).json() == {"ok": 1}
    assert len(calls) == 3 and pauses == [2.0, 4.0]


def test_retry_gives_up_with_last_error():
    get, calls = _scripted([requests.ConnectionError("down")] * 3)
    with pytest.raises(requests.ConnectionError):
        http_retry.get(get, "u", sleep=lambda s: None)
    assert len(calls) == 3


def test_retry_does_not_repeat_client_errors():
    get, calls = _scripted([_Resp(403), _Resp(200)])
    with pytest.raises(requests.HTTPError):
        http_retry.get(get, "u", sleep=lambda s: None)
    assert len(calls) == 1


def test_trudvsem_fetch_retries(monkeypatch):
    get, calls = _scripted([requests.ReadTimeout("slow"), _Resp(200, {"results": {}})])
    monkeypatch.setattr(trudvsem.requests, "get", get)
    monkeypatch.setattr(http_retry.time, "sleep", lambda s: None)
    assert trudvsem.fetch_json(trudvsem.API, {}) == {"results": {}}
    assert len(calls) == 2


def test_superjob_fetch_retries(monkeypatch):
    get, calls = _scripted([_Resp(502), _Resp(200, {"objects": []})])
    monkeypatch.setattr(superjob.requests.Session, "get", lambda self, url, **kw: get(url, **kw))
    monkeypatch.setattr(http_retry.time, "sleep", lambda s: None)
    monkeypatch.setattr(superjob, "REQUEST_PAUSE", 0)
    assert superjob.make_fetch("key")({}) == {"objects": []}
    assert len(calls) == 2


# --- User-Agent -----------------------------------------------------------------


def test_telegram_feed_is_read_with_honest_user_agent(monkeypatch):
    seen = {}

    class Resp:
        url, text = "https://t.me/s/ch", "<html></html>"

        def raise_for_status(self):
            pass

    def fake_get(url, headers=None, timeout=None):
        seen.update(headers or {})
        return Resp()

    monkeypatch.setattr(main.requests, "get", fake_get)
    main.fetch_page("https://t.me/s/ch")
    assert "FastCVBot" in seen["User-Agent"]
