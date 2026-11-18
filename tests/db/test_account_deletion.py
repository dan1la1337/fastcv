"""delete_my_account() удаляет аккаунт и у кандидата с откликами, и у работодателя
с вакансиями: внешние ключи на профиль и вакансию не мешают удалению."""

from __future__ import annotations

import pytest

from test_rls import database, psql  # noqa: F401  (фикстура database: чистая база со всеми миграциями)

C = "00000000-0000-0000-0000-00000000d0c1"   # кандидат, удаляет аккаунт
C2 = "00000000-0000-0000-0000-00000000d0c2"  # кандидат, остаётся
E = "00000000-0000-0000-0000-00000000d0e1"   # работодатель, удаляет аккаунт
E2 = "00000000-0000-0000-0000-00000000d0e2"  # работодатель, остаётся


def apply(candidate: str, title: str):
    ok, out = psql(f"insert into applications (vacancy_id, candidate_id, cover_letter) "
                   f"select id, '{candidate}', 'hi' from vacancies where title = '{title}'",
                   role="authenticated", uid=candidate)
    assert ok, out


def delete_account(uid: str):
    return psql("select delete_my_account()", role="authenticated", uid=uid)


@pytest.fixture(scope="module", autouse=True)
def data(database):  # noqa: F811
    ok, out = psql(f"""insert into auth.users values ('{C}', '{{"role":"candidate"}}'), ('{C2}', '{{"role":"candidate"}}'),
            ('{E}', '{{"role":"employer"}}'), ('{E2}', '{{"role":"employer"}}');
        insert into vacancies (title, source_type, employer_id) values
            ('Del E', 'internal', '{E}'), ('Del E2', 'internal', '{E2}')""")
    assert ok, out
    apply(C, "Del E2")
    apply(C2, "Del E")
    apply(C2, "Del E2")
    # Работодатель отвечает: появляются диалог и сообщения с обеих сторон
    for title, employer in (("Del E", E), ("Del E2", E2)):
        ok, out = psql(f"update applications set status = 'viewed' where vacancy_id in (select id from vacancies where title = '{title}')",
                       role="authenticated", uid=employer)
        assert ok, out


def test_candidate_with_application_deletes_account():
    ok, out = delete_account(C)
    assert ok, out
    ok, out = psql(f"""select (select count(*) from auth.users where id = '{C}')
                            + (select count(*) from profiles where id = '{C}')
                            + (select count(*) from applications where candidate_id = '{C}')
                       || ' ' || (select count(*) from vacancies where title = 'Del E2')
                       || ' ' || (select count(*) from applications where candidate_id = '{C2}')""")
    assert (ok, out) == (True, "0 1 2")


def test_employer_with_vacancy_and_applications_deletes_account():
    ok, out = delete_account(E)
    assert ok, out
    ok, out = psql(f"""select (select count(*) from auth.users where id = '{E}')
                            + (select count(*) from profiles where id = '{E}')
                            + (select count(*) from vacancies where employer_id = '{E}')
                       || ' ' || (select count(*) from profiles where id = '{C2}')
                       || ' ' || (select count(*) from applications where candidate_id = '{C2}')
                       || ' ' || (select count(*) from vacancies where title = 'Del E2')""")
    # отклик C2 на вакансию E ушёл вместе с вакансией, отклик на вакансию E2 остался
    assert (ok, out) == (True, "0 1 1 1")


def test_employer_cannot_delete_vacancy_with_applications():
    # Иначе вместе с вакансией ушли бы чужие отклики и отзывы кандидатов о работодателе
    ok, out = psql("delete from vacancies where title = 'Del E2'", role="authenticated", uid=E2)
    assert not ok and "applications_vacancy_id_fkey" in out, out
