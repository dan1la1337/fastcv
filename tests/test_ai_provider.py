"""Провайдер ИИ сборщика выбирается переменной AI_PROVIDER; модели — в ai_client.MODELS."""

import json
import pathlib

import pytest

import ai_client
import reviews
from test_scraper import job


def _env(**values):
    return lambda name: values.get(name)


def test_default_provider_is_gemini_with_models_from_one_list():
    provider, models = ai_client.provider_from_env(_env(GEMINI_API_KEY="g"))
    assert provider.name == "gemini" and models == ai_client.MODELS["gemini"]
    assert reviews.GEMINI_MODELS is ai_client.MODELS["gemini"]


def test_models_are_overridden_by_env():
    _, models = ai_client.provider_from_env(_env(GEMINI_API_KEY="g", GEMINI_MODELS="m1, m2"))
    assert models == ("m1", "m2")
    _, models = ai_client.provider_from_env(_env(GEMINI_API_KEY="g", AI_MODELS="m3", GEMINI_MODELS="m1"))
    assert models == ("m3",)


def test_yandex_provider_from_env():
    provider, models = ai_client.provider_from_env(
        _env(AI_PROVIDER="Yandex", YANDEX_API_KEY="y", YANDEX_FOLDER_ID="f", GEMINI_MODELS="ignored"))
    assert isinstance(provider, ai_client.YandexProvider) and models == ai_client.MODELS["yandex"]


@pytest.mark.parametrize("values, message", [
    ({}, "GEMINI_API_KEY"),
    ({"AI_PROVIDER": "yandex", "YANDEX_API_KEY": "y"}, "YANDEX_FOLDER_ID"),
    ({"AI_PROVIDER": "openai", "GEMINI_API_KEY": "g"}, "AI_PROVIDER"),
])
def test_missing_key_or_unknown_provider(values, message):
    with pytest.raises(ValueError, match=message):
        ai_client.provider_from_env(_env(**values))


class _Resp:
    def __init__(self, status, content=""):
        self.status_code, self.text = status, content

    def json(self):
        return {"choices": [{"message": {"content": self.text}}]}


def _fake_yandex(monkeypatch, replies):
    sent = []

    def post(url, json=None, headers=None, timeout=None):
        sent.append(json)
        return replies[len(sent) - 1]

    monkeypatch.setattr(ai_client.requests, "post", post)
    monkeypatch.setattr(ai_client.time, "sleep", lambda s: None)
    return sent


def test_yandex_normalizer_retries_parses_and_redacts(monkeypatch):
    vacancy = job(contact_type="telegram", contact_value="[контакт1]").model_dump()
    sent = _fake_yandex(monkeypatch, [_Resp(503, "busy"),
                                      _Resp(200, "<think>…</think>```json\n" + json.dumps(vacancy) + "\n```")])
    normalize = ai_client.make_normalizer(ai_client.YandexProvider("key", "folder"), ("yandexgpt/latest",))
    result = normalize("Ищем Python-разработчика, пишите @anna_hr")
    assert result.title == "Python Developer" and result.contact_value == "anna_hr"
    assert sent[1]["model"] == "gpt://folder/yandexgpt/latest"
    user = sent[1]["messages"][1]["content"]
    assert "anna_hr" not in user and "[контакт1]" in user
    assert "JSON Schema" in sent[1]["messages"][0]["content"]
    assert normalize.stats["errors"] == {"yandexgpt/latest: 503": 1} and normalize.provider == "yandex"


def test_yandex_batch_skips_broken_items(monkeypatch):
    good = {"post": 1, "vacancy": job().model_dump()}
    _fake_yandex(monkeypatch, [_Resp(200, json.dumps({"items": [{"post": 0}, good]})),
                               _Resp(200, json.dumps(job(title="Отдельно").model_dump()))])
    normalize = ai_client.make_normalizer(ai_client.YandexProvider("key", "folder"), ("m",))
    result = normalize.many(["пост 0", "пост 1"])
    # битый элемент для поста 0 — пост разобран отдельным запросом
    assert [v.title for v in result] == ["Отдельно", "Python Developer"]


def test_gemini_clients_use_v1beta(monkeypatch):
    """google-genai 3 по умолчанию ходит в v1, где нет алиаса gemini-flash-lite-latest."""
    from google import genai

    options = []

    class Client:
        def __init__(self, api_key, http_options):
            options.append(http_options)

    monkeypatch.setattr(genai, "Client", Client)
    ai_client.GeminiProvider("g")
    reviews.make_writer("g")
    assert [o.api_version for o in options] == ["v1beta", "v1beta"]


def test_models_come_from_shared_ai_models_json():
    """Сайт и сборщик берут провайдер и порядок моделей из одного файла в корне репозитория."""
    config = json.loads(ai_client.MODELS_FILE.read_text(encoding="utf-8"))
    assert ai_client.MODELS_FILE.parent / "ai_client.py" == pathlib.Path(ai_client.__file__).resolve()
    assert ai_client.MODELS == {name: tuple(p["models"]) for name, p in config["providers"].items()}
    assert ai_client.DEFAULT_PROVIDER == config["provider"]


def test_load_models_reads_the_given_file(tmp_path):
    path = tmp_path / "ai-models.json"
    path.write_text(json.dumps({"provider": "yandex", "providers": {
        "gemini": {"models": ["g1"]}, "yandex": {"models": ["y1", "y2"]}}}), encoding="utf-8")
    assert ai_client.load_models(path) == ({"gemini": ("g1",), "yandex": ("y1", "y2")}, "yandex")
    path.write_text(json.dumps({"provider": "openai", "providers": {"gemini": {"models": ["g1"]}}}), encoding="utf-8")
    with pytest.raises(ValueError, match="ai-models.json"):
        ai_client.load_models(path)
