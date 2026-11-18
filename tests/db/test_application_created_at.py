"""Время создания отклика ставит база (#144): старая или будущая created_at
не выводит отклик из-под дневного лимита в 15 откликов."""

from __future__ import annotations

import pytest

from test_rls import database, psql  # noqa: F401  (фикстура database: чистая база со всеми миграциями)

C = "00000000-0000-0000-0000-0000000144c1"  # кандидат
E = "00000000-0000-0000-0000-0000000144e1"  # работодатель


def as_candidate(sql: str):
    return psql(sql, role="authenticated", uid=C)


@pytest.fixture(scope="module", autouse=True)
def users(database):  # noqa: F811
    ok, out = psql(f"""insert into auth.users values ('{C}', '{{"role":"candidate"}}'), ('{E}', '{{"role":"employer"}}');
        insert into vacancies (title, source_type, employer_id)
        select 'Limit ' || n, 'internal', '{E}' from generate_series(1, 17) n""")
    assert ok, out


def test_past_created_at_is_replaced_with_now():
    ok, out = as_candidate(f"""insert into applications (vacancy_id, candidate_id, created_at)
        select id, '{C}', now() - interval '11 days' from vacancies where title = 'Limit 1'""")
    assert ok, out
    ok, out = psql("select a.created_at > now() - interval '1 minute' from applications a "
                   "join vacancies v on v.id = a.vacancy_id where v.title = 'Limit 1'")
    assert (ok, out) == (True, "t")


def test_future_created_at_is_replaced_with_now():
    ok, out = as_candidate(f"""insert into applications (vacancy_id, candidate_id, created_at)
        select id, '{C}', now() + interval '30 days' from vacancies where title = 'Limit 2'""")
    assert ok, out
    ok, out = psql("select a.created_at < now() + interval '1 minute' from applications a "
                   "join vacancies v on v.id = a.vacancy_id where v.title = 'Limit 2'")
    assert (ok, out) == (True, "t")


def test_sixteenth_backdated_application_is_rejected():
    # 13 ещё — итого 15 за сутки, все с подставленной старой датой
    for n in range(3, 16):
        ok, out = as_candidate(f"""insert into applications (vacancy_id, candidate_id, created_at)
            select id, '{C}', now() - interval '11 days' from vacancies where title = 'Limit {n}'""")
        assert ok, out
    ok, out = as_candidate(f"""insert into applications (vacancy_id, candidate_id, created_at)
        select id, '{C}', now() - interval '11 days' from vacancies where title = 'Limit 16'""")
    assert not ok and "apply_limit" in out, out
    ok, out = psql(f"select count(*) from applications where candidate_id = '{C}' and created_at > now() - interval '24 hours'")
    assert (ok, out) == (True, "15")


def test_employer_cannot_backdate_application():
    ok, out = psql("update applications set created_at = now() - interval '11 days' where vacancy_id in "
                   "(select id from vacancies where title = 'Limit 1')", role="authenticated", uid=E)
    assert not ok, out
