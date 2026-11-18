"""Служебные колонки profiles читает только владелец (#141): telegram_link_code,
telegram_chat_id, resume_path, company_verify_token. Работодатель не перехватывает
привязку Telegram кандидата, который откликнулся на его вакансию."""

from __future__ import annotations

import pytest

from test_rls import database, psql  # noqa: F401  (фикстура database: чистая база со всеми миграциями)

C = "00000000-0000-0000-0000-0000000141c1"  # кандидат
E = "00000000-0000-0000-0000-0000000141e1"  # работодатель, кандидат ему откликнулся
SECRET = ("telegram_link_code", "telegram_chat_id", "resume_path", "company_verify_token")


def as_user(uid: str, sql: str):
    return psql(sql, role="authenticated", uid=uid)


@pytest.fixture(scope="module", autouse=True)
def data(database):  # noqa: F811
    ok, out = psql(f"""insert into auth.users values ('{C}', '{{"role":"candidate"}}'), ('{E}', '{{"role":"employer"}}');
        update profiles set name = 'Кандидат', skills = '["Python"]', resume_path = '{C}/resume.pdf' where id = '{C}';
        update profiles set name = 'ООО Ромашка', company_verify_token = 'emp-token' where id = '{E}';
        insert into vacancies (title, source_type, employer_id) values ('Private cols', 'internal', '{E}')""")
    assert ok, out
    ok, out = as_user(C, f"insert into applications (vacancy_id, candidate_id) select id, '{C}' from vacancies where title = 'Private cols'")
    assert ok, out
    ok, out = as_user(C, "select length(create_telegram_link_code())")
    assert (ok, out) == (True, "32"), out


@pytest.mark.parametrize("column", SECRET)
def test_employer_does_not_read_candidate_secret(column):
    ok, out = as_user(E, f"select {column} from profiles where id = '{C}'")
    assert not ok and "permission denied" in out, out


@pytest.mark.parametrize("column", SECRET)
def test_candidate_does_not_read_employer_secret(column):
    ok, out = as_user(C, f"select {column} from profiles where id = '{E}'")
    assert not ok and "permission denied" in out, out


def test_employer_cannot_relink_candidate_telegram():
    # Код не прочитать, а подобрать 32 случайных hex-символа нереально: перепривязать нечем
    ok, out = as_user(E, f"select link_telegram_chat((select telegram_link_code from profiles where id = '{C}'), 666)")
    assert not ok, out
    ok, out = psql(f"select coalesce(telegram_chat_id::text, 'нет') from profiles where id = '{C}'")
    assert (ok, out) == (True, "нет")


def test_employer_still_sees_applicant_card():
    ok, out = as_user(E, f"select name || ':' || has_resume from profiles where id = '{C}'")
    assert (ok, out) == (True, "Кандидат:true")


def test_owner_reads_own_secrets():
    ok, out = as_user(C, "select resume_path || ':' || coalesce(telegram_chat_id::text, 'нет') from my_private_profile()")
    assert (ok, out) == (True, f"{C}/resume.pdf:нет")
    ok, out = as_user(E, "select company_verify_token from my_private_profile()")
    assert (ok, out) == (True, "emp-token")


def test_bot_links_telegram_by_code():
    ok, out = psql(f"""select from set_config('t.code', (select telegram_link_code from profiles where id = '{C}'), false);
        set role anon;
        select link_telegram_chat(current_setting('t.code'), 555)::text""")
    assert (ok, out) == (True, "true")
    ok, out = as_user(C, "select telegram_chat_id from my_private_profile()")
    assert (ok, out) == (True, "555")


def test_owner_updates_profile_and_resume_path():
    # Так пишет сайт: UPDATE по id и upsert профиля без возврата строки
    ok, out = as_user(C, f"""update profiles set resume_path = null where id = '{C}';
        insert into profiles (id, role, name) values ('{C}', 'candidate', 'Кандидат 2')
          on conflict (id) do update set name = excluded.name, role = excluded.role;
        select name || ':' || has_resume from profiles where id = '{C}'""")
    assert (ok, out) == (True, "Кандидат 2:false")


def test_only_secret_columns_are_closed():
    # Новая колонка profiles без grant select сюда попадёт — сайт её не прочитал бы
    ok, out = psql("""select string_agg(column_name, ',' order by column_name) from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and not has_column_privilege('authenticated', 'public.profiles', column_name, 'select')""")
    assert (ok, out) == (True, ",".join(sorted(SECRET)))


def test_matching_functions_still_work():
    ok, out = as_user(E, "select count(*) from my_application_matches()")
    assert (ok, out) == (True, "1"), out
    ok, out = as_user(C, "select count(*) from my_vacancy_matches(array(select id from vacancies where title = 'Private cols'))")
    assert (ok, out) == (True, "1"), out
    ok, out = as_user(C, "select count(*) >= 0 from recommended_vacancies(5, 0)")
    assert (ok, out) == (True, "t"), out
