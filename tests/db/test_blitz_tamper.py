"""Ответы на микро-блиц и сохранённую ИИ-выжимку работодатель не переписывает."""

from __future__ import annotations

import pytest

from test_rls import database, psql  # noqa: F401  (фикстура database: чистая база со всеми миграциями)

C = "00000000-0000-0000-0000-00000000b1c1"  # кандидат
E = "00000000-0000-0000-0000-00000000b1e1"  # работодатель
APP = "(select a.id from applications a join vacancies v on v.id = a.vacancy_id where v.title = 'Blitz')"


def as_employer(sql: str):
    return psql(sql, role="authenticated", uid=E)


@pytest.fixture(scope="module", autouse=True)
def application(database):  # noqa: F811
    ok, out = psql(f"""insert into auth.users values ('{C}', '{{"role":"candidate"}}'), ('{E}', '{{"role":"employer"}}');
        insert into vacancies (title, source_type, employer_id, blitz_questions)
        values ('Blitz', 'internal', '{E}', '["Опыт с Postgres?"]')""")
    assert ok, out
    ok, out = psql(f"""insert into applications (vacancy_id, candidate_id, blitz_answers)
        select id, '{C}', '["Пять лет"]' from vacancies where title = 'Blitz'""", role="authenticated", uid=C)
    assert ok, out


def test_employer_cannot_change_blitz_answers():
    ok, out = as_employer(f"""update applications set blitz_answers = '[{{"q": "Опыт с Postgres?", "a": "Десять лет"}}]'
        where id = {APP}""")
    assert not ok, out


def test_employer_saves_summary_once():
    ok, out = as_employer(f"update applications set blitz_summary = '• Пять лет с Postgres' where id = {APP}")
    assert ok, out


def test_employer_cannot_rewrite_saved_summary():
    for value in ("'• Подделка'", "null"):
        ok, out = as_employer(f"update applications set blitz_summary = {value} where id = {APP}")
        assert not ok, f"{value}: {out}"
    ok, out = psql(f"select blitz_summary from applications where id = {APP}")
    assert (ok, out) == (True, "• Пять лет с Postgres")


def test_employer_still_changes_status():
    ok, out = as_employer(f"update applications set status = 'viewed' where id = {APP}")
    assert ok, out


def test_service_role_can_reset_summary():
    ok, out = psql(f"update applications set blitz_summary = null where id = {APP} returning id", role="service_role")
    assert ok and out, out
