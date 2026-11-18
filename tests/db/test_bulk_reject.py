"""Массовый отказ и ошибки доступа, на которые опирается интерфейс кабинетов.

Кабинет работодателя обновляет отклики через `update ... in (ids) returning id` и
считает неотправленными те ID, которых нет в ответе. /admin отдаёт 404 только на
отказ в доступе (SQLSTATE 42501), остальные ошибки показывает.
"""

from __future__ import annotations

import pytest

from test_rls import database, psql  # noqa: F401  (фикстура database: чистая база со всеми миграциями)

C = "00000000-0000-0000-0000-0000000b0c01"   # кандидат
E = "00000000-0000-0000-0000-0000000b0e01"   # работодатель
E2 = "00000000-0000-0000-0000-0000000b0e02"  # другой работодатель
APP = "(select a.id from applications a join vacancies v on v.id = a.vacancy_id where v.title = '{}')"
OWN, FOREIGN = APP.format("BulkOwn"), APP.format("BulkForeign")


@pytest.fixture(scope="module", autouse=True)
def applications(database):  # noqa: F811
    ok, out = psql(f"""insert into auth.users values ('{C}', '{{"role":"candidate"}}'),
        ('{E}', '{{"role":"employer"}}'), ('{E2}', '{{"role":"employer"}}');
        insert into vacancies (title, source_type, employer_id)
        values ('BulkOwn', 'internal', '{E}'), ('BulkForeign', 'internal', '{E2}')""")
    assert ok, out
    ok, out = psql("""insert into applications (vacancy_id, candidate_id)
        select id, auth.uid() from vacancies where title in ('BulkOwn', 'BulkForeign')""", role="authenticated", uid=C)
    assert ok, out


def test_bulk_reject_returns_only_updated_ids():
    """Чужой отклик в пачке не даёт ошибки: его просто нет в ответе — интерфейс считает его неотправленным."""
    ok, out = psql(f"""update applications set status = 'rejected', hr_message = 'Спасибо за отклик', hr_replied_at = now()
        where id in ({OWN}, {FOREIGN}) returning id = {OWN}""", role="authenticated", uid=E)
    assert (ok, out) == (True, "t"), out
    ok, out = psql(f"select status from applications where id = {FOREIGN}")
    assert (ok, out) == (True, "new"), out


@pytest.mark.parametrize("role, uid", [("authenticated", E), ("anon", None)])
def test_admin_metrics_denied_with_42501(role, uid):
    ok, out = psql("""do $$ begin perform admin_metrics(); raise notice 'allowed';
        exception when insufficient_privilege then raise notice 'denied'; end $$""", role=role, uid=uid)
    assert ok and "denied" in out, out
