"""Фильтр дискриминации: флаги модели и правил пишутся в vacancies.discrimination_flags."""

import pytest

import discrimination
import main
from test_scraper import FakeStore, job, post


@pytest.mark.parametrize("text, flags", [
    ("Требуется менеджер, возраст до 35 лет", ["age"]),
    ("Кандидаты не старше 45 лет", ["age"]),
    ("Ищем сотрудников от 18 до 30 лет", ["age"]),
    ("Ищем активную девушку на ресепшен", ["sex"]),
    ("Пол: мужской. Только мужчины", ["sex"]),
    ("Славянской внешности, грамотная речь", ["nationality"]),
    ("Нужна девушка до 25 лет, только славяне", ["age", "sex", "nationality"]),
])
def test_rules_find_discriminatory_requirements(text, flags):
    assert discrimination.rule_flags(text) == flags


@pytest.mark.parametrize("text", [
    "Ищем Python-разработчика, опыт от 3 лет, гражданство РФ",
    "Опыт работы от 10 до 15 лет в банке",
    "Зарплата 150 000 – 200 000, команда 12 человек, офис на Пушкина 10",
    "Ищем аналитика в команду, удалённо из любой страны",
])
def test_rules_do_not_flag_ordinary_requirements(text):
    assert discrimination.rule_flags(text) == []


def test_saved_vacancy_gets_flags_from_model_and_rules():
    store = FakeStore()
    text = "Ищем Python-разработчика в команду, удалённо, возраст до 35 лет, пишите @hr_lead"
    assert main.process_post(post(text=text), store, lambda t: job(discrimination=["sex"])) == "saved"
    assert store.inserted[0]["discrimination_flags"] == ["age", "sex"]


def test_ordinary_vacancy_is_saved_with_empty_flags():
    store = FakeStore()
    assert main.process_post(post(), store, lambda t: job()) == "saved"
    assert store.inserted[0]["discrimination_flags"] == []


def test_schema_and_prompt_ask_model_for_flags():
    schema = main.VacancyAI.model_json_schema()["properties"]["discrimination"]
    assert schema["items"]["enum"] == ["age", "sex", "nationality"]
    assert "discrimination" in main.PROMPT
    # модель может не вернуть поле — тогда флагов от неё нет
    assert job().discrimination == []
