"""Тесты сборщика без сети: Telegram, Supabase и Gemini подменены."""

from pathlib import Path

import pytest

import main
from main import (
    AIUnavailable,
    ChannelUnavailable,
    Post,
    VacancyAI,
    clean_stack,
    collect_new_posts,
    parse_channel_page,
    process_channel,
    process_post,
)

FIXTURE = (Path(__file__).parent / "fixtures" / "telegram_forpython.html").read_text(encoding="utf-8")


def page(channel: str, ids: list[int], before: int | None = None, text: str = "Python developer, удалёнка, вилка 200 000 — пишите @hr") -> str:
    """Минимальная страница t.me/s/ с постами ids (разметка как в настоящей ленте)."""
    more = f'<a href="/s/{channel}?before={before}" class="tme_messages_more js-messages_more" data-before="{before}"></a>' if before else ""
    msgs = "".join(
        f'<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="{channel}/{i}">'
        f'<div class="tgme_widget_message_text js-message_text">{text} #{i}</div>'
        f'<a class="tgme_widget_message_date" href="https://t.me/{channel}/{i}"><time datetime="2026-10-22T10:00:00+00:00">10:00</time></a>'
        f"</div></div>"
        for i in ids
    )
    return f'<section class="tgme_channel_history">{more}{msgs}</section>'


def job(**overrides) -> VacancyAI:
    data = dict(is_job=True, title="Python Developer", company="Kaspi.kz", description="Описание", salary_min=200000,
                salary_max=None, salary_currency="RUB", city=None, is_remote=True, contact_type="telegram",
                contact_value="@hr", stack=["Python", "python", " Django "])
    data.update(overrides)
    return VacancyAI(**data)


class FakeStore:
    def __init__(self, known: set[str] | None = None, rows: list[dict] | None = None):
        self.known = known or set()
        self.inserted: list[dict] = []
        self.channel_updates: dict[str, dict] = {}
        self.rows = rows or []

    def active_channels(self):
        return self.rows

    def is_known(self, post, raw_hash):
        return post.key in self.known or raw_hash in self.known

    def insert_vacancy(self, payload):
        if payload["source_post"] in self.known:
            return False
        self.known.add(payload["source_post"])
        self.inserted.append(payload)
        return True

    def update_channel(self, username, fields):
        self.channel_updates[username] = fields

    def archive_stale(self, days):
        return 0


# --- разбор настоящей разметки -------------------------------------------------


def test_parses_real_telegram_page():
    posts, before = parse_channel_page(FIXTURE, "forpython")
    assert [p.post_id for p in posts] == [5320, 5321, 5322]
    assert before == 5302
    last = posts[-1]
    assert last.key == "forpython/5322"
    assert last.url == "https://t.me/forpython/5322"
    assert last.posted_at == "2026-10-22T17:11:58+00:00"
    assert last.text.startswith("Data Engineer")
    assert "Kaspi.kz" in last.text
    assert "\n" in last.text  # <br> превращаются в переносы строк


def test_reply_quote_is_not_taken_as_post_text():
    html = (
        '<div class="tgme_widget_message" data-post="ch/7">'
        '<div class="tgme_widget_message_reply"><div class="tgme_widget_message_text">цитата старого поста</div></div>'
        '<div class="tgme_widget_message_text">Сам пост с вакансией</div></div>'
    )
    posts, _ = parse_channel_page(html, "ch")
    assert posts[0].text == "Сам пост с вакансией"


def test_post_without_text_is_kept_with_empty_text():
    html = '<div class="tgme_widget_message" data-post="ch/8"><div class="photo"></div></div>'
    posts, before = parse_channel_page(html, "ch")
    assert posts[0].text == "" and before is None


# --- выбор новых постов --------------------------------------------------------


def test_new_channel_takes_last_posts_only():
    fetch = lambda url: page("ch", list(range(1, 21)))
    posts = collect_new_posts("ch", None, fetch)
    assert [p.post_id for p in posts] == list(range(11, 21))


def test_only_posts_after_last_id():
    fetch = lambda url: page("ch", list(range(1, 21)), before=1)
    assert [p.post_id for p in collect_new_posts("ch", 17, fetch)] == [18, 19, 20]


def test_pages_back_until_last_processed_post():
    pages = {
        "https://t.me/s/ch": page("ch", list(range(41, 61)), before=41),
        "https://t.me/s/ch?before=41": page("ch", list(range(21, 41)), before=21),
        "https://t.me/s/ch?before=21": page("ch", list(range(1, 21)), before=1),
    }
    requested = []

    def fetch(url):
        requested.append(url)
        return pages[url]

    posts = collect_new_posts("ch", 30, fetch)
    assert [p.post_id for p in posts] == list(range(31, 61))
    assert "https://t.me/s/ch?before=21" not in requested  # дальше листать не нужно


def test_paging_is_capped():
    def fetch(url):
        before = int(url.split("before=")[1]) if "before=" in url else 1000
        return page("ch", list(range(before - 20, before)), before=before - 20)

    posts = collect_new_posts("ch", 1, fetch)
    assert len(posts) == 20 * main.MAX_PAGES


def test_empty_feed_means_channel_unavailable():
    with pytest.raises(ChannelUnavailable):
        collect_new_posts("ch", None, lambda url: "<html><body>Contact @ch</body></html>")


# --- обработка поста -----------------------------------------------------------


def post(i=1, text="Ищем Python-разработчика в команду, удалённо, пишите @hr_lead") -> Post:
    return Post("ch", i, text, "2026-10-22T10:00:00+00:00", f"https://t.me/ch/{i}")


def test_saves_vacancy_with_source_link_and_stack():
    store = FakeStore()
    assert process_post(post(), store, lambda t: job()) == "saved"
    saved = store.inserted[0]
    assert saved["source_post"] == "ch/1"
    assert saved["source_url"] == "https://t.me/ch/1"
    assert saved["posted_at"] == "2026-10-22T10:00:00+00:00"
    assert saved["stack"] == ["Python", "Django"]
    assert saved["contact_value"] == "hr"
    assert saved["company_name"] == "Kaspi.kz"


def test_known_post_is_not_sent_to_ai_again():
    store = FakeStore(known={"ch/1"})

    def must_not_call(text):
        raise AssertionError("Gemini не должен вызываться для известного поста")

    assert process_post(post(), store, must_not_call) == "duplicate"


def test_short_and_non_job_posts_are_not_saved():
    store = FakeStore()
    assert process_post(post(text="Привет!"), store, lambda t: job()) == "short"
    assert process_post(post(2), store, lambda t: job(is_job=False, title=None)) == "not_job"
    assert store.inserted == []


def test_salary_currency_saved_only_with_salary():
    store = FakeStore()
    process_post(post(1), store, lambda t: job(salary_min=5000, salary_currency="USD"))
    process_post(post(2, "Ищем дизайнера в команду, удалённо, пишите @hr_lead"), store,
                 lambda t: job(salary_min=None, salary_max=None, salary_currency="RUB"))
    assert store.inserted[0]["salary_currency"] == "USD"
    assert store.inserted[1]["salary_currency"] is None


def test_contact_type_dropped_without_contact_value():
    store = FakeStore()
    process_post(post(), store, lambda t: job(contact_value=None))
    assert store.inserted[0]["contact_type"] is None


def test_clean_stack():
    assert clean_stack([" React ", "react", "", "x" * 50, "TypeScript"]) == ["React", "TypeScript"]


# --- обработка канала ----------------------------------------------------------


def test_channel_progress_saved_and_failure_reset():
    store = FakeStore()
    fetch = lambda url: page("ch", [5, 6, 7], before=None)
    r = process_channel({"username": "@ch", "last_post_id": 4, "failed_runs": 3}, store,
                        lambda t: job(), fetch=fetch, pause=lambda s: None)
    assert (r.new_posts, r.saved, r.error) == (3, 3, None)
    assert store.channel_updates["ch"]["last_post_id"] == 7
    assert store.channel_updates["ch"]["failed_runs"] == 0


def test_ai_outage_keeps_unprocessed_posts_for_next_run():
    store = FakeStore()
    calls = {"n": 0}

    def flaky(text):
        calls["n"] += 1
        if calls["n"] == 2:
            raise AIUnavailable("503")
        return job()

    fetch = lambda url: page("ch", [5, 6, 7])
    r = process_channel({"username": "ch", "last_post_id": 4}, store, flaky, fetch=fetch, pause=lambda s: None)
    assert r.ai_stopped and r.saved == 1
    # Пост 6 не обработан — в следующий раз начнём с него
    assert store.channel_updates["ch"]["last_post_id"] == 5


def test_unavailable_channel_counts_failures():
    store = FakeStore()
    r = process_channel({"username": "closed", "last_post_id": None, "failed_runs": 2}, store,
                        lambda t: job(), fetch=lambda url: "<html></html>", pause=lambda s: None)
    assert r.error
    assert store.channel_updates["closed"]["failed_runs"] == 3
    assert "last_post_id" not in store.channel_updates["closed"]


def test_edited_post_is_not_duplicated():
    """Отредактированный пост имеет тот же id, но другой текст — второй записи быть не должно."""
    store = FakeStore()
    process_post(post(1, "Ищем Python-разработчика, удалёнка, пишите @hr_lead"), store, lambda t: job())
    edited = post(1, "Ищем Python-разработчика, удалёнка, зарплата выросла! Пишите @hr_lead")
    assert process_post(edited, store, lambda t: job()) == "duplicate"
    assert len(store.inserted) == 1


# --- повторы запросов к Gemini --------------------------------------------------


class _FakeResponse:
    def __init__(self, parsed):
        self.parsed = parsed
        self.text = parsed.model_dump_json()


def _fake_gemini(monkeypatch, outcomes):
    """Подменяет google.genai.Client: generate_content по очереди отдаёт outcomes."""
    from google import genai

    calls = {"n": 0, "models": []}

    class Models:
        def generate_content(self, **kwargs):
            calls["models"].append(kwargs["model"])
            item = outcomes[calls["n"]]
            calls["n"] += 1
            if isinstance(item, Exception):
                raise item
            return _FakeResponse(item)

    class Client:
        def __init__(self, api_key, http_options=None):
            calls["timeout"] = http_options.timeout if http_options else None
            self.models = Models()

    monkeypatch.setattr(genai, "Client", Client)
    monkeypatch.setattr(main.time, "sleep", lambda s: None)
    return calls


def _api_error(code):
    from google.genai import errors
    cls = errors.ServerError if code >= 500 else errors.ClientError
    return cls(code, {"error": {"code": code, "message": "x", "status": "UNAVAILABLE" if code >= 500 else "INVALID_ARGUMENT"}})


MODELS = ("model-a", "model-b", "model-c")


def test_gemini_falls_back_to_next_model_when_overloaded(monkeypatch):
    calls = _fake_gemini(monkeypatch, [_api_error(503), _api_error(429), job()])
    result = main.make_gemini_normalizer("key", MODELS)("текст")
    assert result.title == "Python Developer"
    # две попытки на перегруженной модели, затем успех на следующей
    assert calls["models"] == ["model-a", "model-a", "model-b"]
    assert calls["timeout"] == main.AI_TIMEOUT_MS


def test_gemini_missing_model_is_skipped_immediately(monkeypatch):
    calls = _fake_gemini(monkeypatch, [_api_error(404), job()])
    main.make_gemini_normalizer("key", MODELS)("текст")
    assert calls["models"] == ["model-a", "model-b"]


def test_gemini_gives_up_after_all_models(monkeypatch):
    calls = _fake_gemini(monkeypatch, [_api_error(503)] * (main.AI_ATTEMPTS * len(MODELS)))
    with pytest.raises(AIUnavailable):
        main.make_gemini_normalizer("key", MODELS)("текст")
    assert calls["n"] == main.AI_ATTEMPTS * len(MODELS)


def test_gemini_does_not_retry_bad_request(monkeypatch):
    calls = _fake_gemini(monkeypatch, [_api_error(400), job()])
    with pytest.raises(AIUnavailable):
        main.make_gemini_normalizer("key", MODELS)("текст")
    assert calls["n"] == 1


def test_circuit_breaker_stops_after_consecutive_ai_failures(monkeypatch):
    """Если Gemini не отвечает на нескольких каналах подряд, остальные не трогаем."""
    monkeypatch.setattr(main.time, "sleep", lambda s: None)
    rows = [{"username": f"ch{i}", "last_post_id": 1} for i in range(6)]
    store = FakeStore(rows=rows)
    fetched = []

    def fetch(url):
        fetched.append(url)
        channel = url.split("/s/")[1].split("?")[0]
        return page(channel, [2])

    monkeypatch.setattr(main, "fetch_page", fetch)
    # process_channel берёт fetch по умолчанию из модуля — подменяем через обёртку
    original = main.process_channel
    monkeypatch.setattr(main, "process_channel", lambda row, st, norm: original(row, st, norm, fetch=fetch, pause=lambda s: None))

    def down(text):
        raise AIUnavailable("503")

    results = main.run(store, down)
    assert len(results) == main.AI_CIRCUIT_BREAKER
    assert len(fetched) == main.AI_CIRCUIT_BREAKER
    # отложенные каналы не тронуты: их last_post_id не менялся
    assert set(store.channel_updates) == {f"ch{i}" for i in range(main.AI_CIRCUIT_BREAKER)}
