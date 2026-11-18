"""Обезличивание постов перед Gemini: телефоны, ники и имена не уходят в модель,
а контакт для отклика сохраняется в вакансии."""

import main
import redact
from test_scraper import MODELS, job

POST = ("Ищем Python-разработчика в Kaspi.kz, удалёнка, 300 000 – 400 000 ₽.\n"
        "HR: Анна Петрова, пишите @anna_hr или t.me/kaspi_jobs, тел. +7 (999) 123-45-67, "
        "резюме на anna.petrova@kaspi.kz")


def test_redact_removes_phone_handles_names_and_email():
    clean, table = redact.redact(POST)
    for secret in ("anna_hr", "kaspi_jobs", "123-45-67", "Анна", "Петрова", "anna.petrova@kaspi.kz"):
        assert secret not in clean
    # остальное на месте: зарплата, компания, должность
    assert "300 000 – 400 000" in clean and "Kaspi.kz" in clean and "Python-разработчика" in clean
    assert table["[контакт1]"] == "@anna_hr" and table["[email1]"] == "anna.petrova@kaspi.kz"
    assert table["[имя1]"] == "Анна Петрова"
    assert redact.restore(clean, table) == POST


def test_redact_keeps_salaries_and_post_links():
    text = "Зарплата 150 000 – 200 000 руб, подробности t.me/jobs/123, пишите в Telegram"
    clean, table = redact.redact(text)
    assert clean == text and table == {}


def test_same_handle_gets_same_token():
    clean, table = redact.redact("пишите @anna_hr, повторяю: @anna_hr")
    assert clean.count("[контакт1]") == 2 and len(table) == 1


def test_restore_contact_from_token():
    _, table = redact.redact(POST)
    assert redact.restore_contact("[контакт1]", table) == ("telegram", "anna_hr")
    assert redact.restore_contact("[контакт2]", table) == ("telegram", "kaspi_jobs")   # из t.me/kaspi_jobs
    assert redact.restore_contact("@[контакт1]", table) == ("telegram", "anna_hr")
    assert redact.restore_contact("[email1]", table) == ("email", "anna.petrova@kaspi.kz")
    assert redact.restore_contact("[контакт9]", table) == (None, None)   # модель придумала метку


def _capture_gemini(monkeypatch, reply):
    from google import genai

    sent = []

    class Resp:
        def __init__(self, parsed):
            self.parsed, self.text = parsed, ""

    class Models:
        def generate_content(self, **kwargs):
            sent.append(kwargs["contents"])
            return Resp(reply(kwargs["contents"]))

    class Client:
        def __init__(self, api_key, http_options=None):
            self.models = Models()

    monkeypatch.setattr(genai, "Client", Client)
    return sent


def test_gemini_gets_redacted_post_and_vacancy_keeps_contact(monkeypatch):
    sent = _capture_gemini(monkeypatch, lambda _: job(contact_type="telegram", contact_value="[контакт1]",
                                                      description="Пишите [имя1] в [контакт1]"))
    vacancy = main.make_gemini_normalizer("key", MODELS)(POST)
    assert "anna_hr" not in sent[0] and "+7 (999)" not in sent[0] and "Анна" not in sent[0]
    assert vacancy.contact_type == "telegram" and vacancy.contact_value == "anna_hr"
    assert vacancy.description == "Пишите Анна Петрова в @anna_hr"


def test_gemini_batch_is_redacted_per_post(monkeypatch):
    posts = ["Вакансия 1, пишите @first_hr", "Вакансия 2, почта jobs@corp.ru"]
    reply = [main.BatchItem(post=0, vacancy=job(contact_value="[контакт1]")),
             main.BatchItem(post=1, vacancy=job(contact_type="telegram", contact_value="[email1]"))]
    sent = _capture_gemini(monkeypatch, lambda _: reply)
    result = main.make_gemini_normalizer("key", MODELS).many(posts)
    assert "first_hr" not in sent[0] and "jobs@corp.ru" not in sent[0]
    assert (result[0].contact_type, result[0].contact_value) == ("telegram", "first_hr")
    assert (result[1].contact_type, result[1].contact_value) == ("email", "jobs@corp.ru")
