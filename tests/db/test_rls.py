"""Правила доступа к базе (RLS) на чистом Postgres со всеми миграциями supabase/migrations.

Каждая проверка — запрос от имени роли Supabase (anon, authenticated с id
пользователя, service_role) и ожидаемый результат. Проверки идут по порядку
и образуют сценарий: регистрация → вакансии → отклики → резюме → письма.

Запуск: нужен Postgres 15+ и psql. Подключение — через стандартные переменные
PGHOST / PGPORT / PGUSER / PGPASSWORD, база FASTCV_TEST_DB (по умолчанию
fastcv_test) пересоздаётся. Без FASTCV_DB_TESTS=1 тесты пропускаются, чтобы
`pytest tests` работал и без базы.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DB = os.getenv("FASTCV_TEST_DB", "fastcv_test")

pytestmark = pytest.mark.skipif(
    os.getenv("FASTCV_DB_TESTS") != "1" or not shutil.which("psql"),
    reason="нужны FASTCV_DB_TESTS=1, psql и доступ к Postgres",
)

C = "11111111-1111-1111-1111-111111111111"   # кандидат
E = "22222222-2222-2222-2222-222222222222"   # работодатель
X = "33333333-3333-3333-3333-333333333333"   # другой кандидат
E2 = "44444444-4444-4444-4444-444444444444"  # другой работодатель


def psql(sql: str, db: str = DB, role: str = "postgres", uid: str | None = None, file: Path | None = None):
    prefix = ""
    if role != "postgres":
        prefix = f"set role {role}; " + (f"set request.jwt.claim.sub = '{uid}'; " if uid else "")
    args = ["psql", "-d", db, "-v", "ON_ERROR_STOP=1", "-tAq"]
    args += ["-f", str(file)] if file else ["-c", prefix + sql]
    r = subprocess.run(args, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() or r.stderr.strip())


@pytest.fixture(scope="module", autouse=True)
def database():
    """Чистая база: заглушки Supabase и схема, применённая дважды (скрипт должен быть повторяемым)."""
    for sql in (f"drop database if exists {DB}", f"create database {DB}"):
        ok, out = psql(sql, db="postgres")
        assert ok, out
    # Роли общие для кластера: при повторном запуске их уже нет смысла создавать
    ok, out = psql("select count(*) from pg_roles where rolname = 'authenticated'")
    stub = (ROOT / "tests/db/stub.sql").read_text()
    if out == "1":
        stub = "\n".join(line for line in stub.splitlines() if not line.startswith("create role"))
    tmp = ROOT / "tests/db/.stub_run.sql"
    tmp.write_text(stub)
    try:
        ok, out = psql("", file=tmp)
        assert ok, out
    finally:
        tmp.unlink()
    migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    assert migrations, "нет миграций в supabase/migrations"
    # Базовую миграцию — дважды: она обязана быть повторяемой (её применяли к рабочей базе)
    for migration in [migrations[0], *migrations]:
        ok, out = psql("", file=migration)
        assert ok, f"{migration.name}: {out}"
    yield


# (название, должен ли запрос пройти, SQL, роль, id пользователя, ожидаемый вывод)
CHECKS: list[tuple] = [
    # --- регистрация: профиль создаёт триггер ---
    ("триггер создал профили с ролями", True,
     f"""insert into auth.users values ('{C}', '{{"role":"candidate"}}'), ('{E}', '{{"role":"employer"}}'),
         ('{X}', '{{}}'), ('{E2}', '{{"role":"employer"}}');
         select string_agg(role, ',' order by id) from profiles""",
     "postgres", None, "candidate,employer,candidate,employer"),

    # --- вакансии ---
    ("сборщик (service_role) пишет вакансию", True,
     "insert into vacancies (title, source_type) values ('Ext', 'external')", "service_role", None, None),
    ("аноним НЕ пишет вакансию", False,
     "insert into vacancies (title, source_type) values ('Spam', 'external')", "anon", None, None),
    ("аноним читает вакансии", True, "select count(*) from vacancies", "anon", None, "1"),
    ("работодатель публикует свою вакансию", True,
     f"insert into vacancies (title, source_type, employer_id, ranking_weight, city) values ('Int Junior Python developer', 'internal', '{E}', 1.5, 'спб')",
     "authenticated", E, None),
    ("вакансия нормализована триггером", True,
     "select level || ',' || direction || ',' || city || ',' || work_format from vacancies where title like 'Int%'",
     "postgres", None, "junior,backend,Санкт-Петербург,office"),
    ("кандидат НЕ публикует вакансию", False,
     f"insert into vacancies (title, source_type, employer_id) values ('Fake', 'internal', '{C}')", "authenticated", C, None),
    ("работодатель НЕ публикует от чужого имени", False,
     f"insert into vacancies (title, source_type, employer_id) values ('Fake', 'internal', '{E2}')", "authenticated", E, None),
    ("работодатель НЕ задирает ranking_weight: вес вакансий работодателей ставит база", True,
     f"""insert into vacancies (title, source_type, employer_id, ranking_weight) values ('Top', 'internal', '{E}', 100);
         select ranking_weight::text from vacancies where title = 'Top'""",
     "authenticated", E, "1.5"),
    ("работодатель НЕ выдаёт свою вакансию за внешнюю", False,
     f"insert into vacancies (title, source_type, employer_id) values ('Fake', 'external', '{E}')", "authenticated", E, None),
    ("чужой работодатель НЕ удаляет вакансию", True,
     "delete from vacancies where title like 'Int%' returning id", "authenticated", E2, ""),
    ("чужой работодатель НЕ меняет вакансию", True,
     "update vacancies set title = 'hacked' where title like 'Int%' returning id", "authenticated", E2, ""),

    # --- профили и роли ---
    ("кандидат НЕ становится работодателем", False,
     "update profiles set role = 'employer' where id = auth.uid()", "authenticated", C, None),
    ("кандидат меняет имя и навыки", True,
     "update profiles set name = 'Иван', skills = '[\"Python\"]' where id = auth.uid()", "authenticated", C, None),
    ("кандидат НЕ меняет чужой профиль", True,
     f"update profiles set name = 'x' where id = '{X}' returning id", "authenticated", C, ""),
    ("админ может сменить роль", True, f"update profiles set role = 'candidate' where id = '{X}'", "postgres", None, None),
    ("аноним НЕ читает профили", True, "select count(*) from profiles", "anon", None, "0"),

    # --- отклики ---
    ("кандидат откликается", True,
     f"insert into applications (vacancy_id, candidate_id, cover_letter) select id, '{C}', 'hi' from vacancies where title like 'Int%'",
     "authenticated", C, None),
    ("отклик НЕ от чужого имени", False,
     f"insert into applications (vacancy_id, candidate_id) select id, '{X}' from vacancies where title = 'Ext'",
     "authenticated", C, None),
    ("работодатель НЕ откликается", False,
     f"insert into applications (vacancy_id, candidate_id) select id, '{E}' from vacancies where title = 'Ext'",
     "authenticated", E, None),
    ("отклик НЕ создаётся сразу с собеседованием", False,
     f"insert into applications (vacancy_id, candidate_id, status) select id, '{C}', 'interview_scheduled' from vacancies where title = 'Ext'",
     "authenticated", C, None),
    ("работодатель видит отклик на свою вакансию", True, "select count(*) from applications", "authenticated", E, "1"),
    ("аноним НЕ читает отклики", True, "select count(*) from applications", "anon", None, "0"),
    ("чужой работодатель НЕ видит отклик", True, "select count(*) from applications", "authenticated", E2, "0"),
    ("другой кандидат НЕ видит отклик", True, "select count(*) from applications", "authenticated", X, "0"),
    ("работодатель видит профиль откликнувшегося", True,
     f"select name from profiles where id = '{C}'", "authenticated", E, "Иван"),
    ("чужой работодатель НЕ видит профиль кандидата", True,
     f"select count(*) from profiles where id = '{C}'", "authenticated", E2, "0"),
    ("кандидат видит профиль работодателя", True,
     f"select count(*) from profiles where id = '{E}'", "authenticated", C, "1"),
    ("работодатель меняет статус", True,
     "update applications set status = 'interview_scheduled', hr_replied_at = now()", "authenticated", E, None),
    ("работодатель НЕ меняет текст письма", False,
     "update applications set cover_letter = 'x'", "authenticated", E, None),
    ("кандидат НЕ меняет себе статус", True,
     "update applications set status = 'new' returning id", "authenticated", C, ""),
    ("чужой работодатель НЕ меняет статус", True,
     "update applications set status = 'rejected' returning id", "authenticated", E2, ""),

    # --- каналы сборщика ---
    ("пользователь НЕ видит channels", True, "select count(*) from channels", "authenticated", C, "0"),
    ("аноним НЕ пишет в channels", False, "insert into channels (username) values ('x')", "anon", None, None),

    # --- резюме (Storage) ---
    ("бакет приватный, только PDF до 5 МБ", True,
     "select public::text || ',' || file_size_limit || ',' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'resumes'",
     "postgres", None, "false,5242880,application/pdf"),
    ("кандидат загружает своё резюме", True,
     f"insert into storage.objects (bucket_id, name) values ('resumes', '{C}/resume.pdf')", "authenticated", C, None),
    ("кандидат НЕ кладёт файл в чужую папку", False,
     f"insert into storage.objects (bucket_id, name) values ('resumes', '{X}/resume.pdf')", "authenticated", C, None),
    ("другой кандидат загружает своё", True,
     f"insert into storage.objects (bucket_id, name) values ('resumes', '{X}/resume.pdf')", "authenticated", X, None),
    ("работодатель видит резюме откликнувшегося", True,
     f"select count(*) from storage.objects where name = '{C}/resume.pdf'", "authenticated", E, "1"),
    ("работодатель НЕ видит резюме не откликавшегося", True,
     f"select count(*) from storage.objects where name = '{X}/resume.pdf'", "authenticated", E, "0"),
    ("чужой работодатель НЕ видит резюме", True,
     "select count(*) from storage.objects where bucket_id = 'resumes'", "authenticated", E2, "0"),
    ("аноним НЕ видит резюме", True, "select count(*) from storage.objects", "anon", None, "0"),
    ("работодатель НЕ удаляет чужое резюме", True,
     f"delete from storage.objects where name = '{C}/resume.pdf' returning id", "authenticated", E, ""),
    ("кандидат удаляет своё резюме", True,
     f"delete from storage.objects where name = '{X}/resume.pdf' returning name", "authenticated", X, f"{X}/resume.pdf"),

    # --- лимит ИИ ---
    ("аноним НЕ тратит лимит ИИ", False,
     "select public.consume_ai_quota('cover_letter', 10, 3600)", "anon", None, None),
    ("лимит ИИ: 3 вызова из 3 разрешены, четвёртый — нет", True,
     "select string_agg((public.consume_ai_quota('cover_letter', 3, 3600)->>'allowed'), ',') from generate_series(1, 4)",
     "authenticated", C, "true,true,true,false"),
    ("лимит ИИ у другого пользователя свой", True,
     "select public.consume_ai_quota('cover_letter', 3, 3600)->>'allowed'", "authenticated", X, "true"),
    ("пользователь НЕ читает журнал вызовов ИИ", False, "select count(*) from ai_usage", "authenticated", C, None),

    # --- кэш сопроводительных писем ---
    ("кандидат сохраняет своё письмо", True,
     f"insert into cover_letters (user_id, vacancy_id, input_hash, text) select '{C}', id, 'h', 'letter' from vacancies where title = 'Ext'",
     "authenticated", C, None),
    ("письмо НЕ сохраняется от чужого имени", False,
     f"insert into cover_letters (user_id, vacancy_id, input_hash, text) select '{X}', id, 'h', 'forged' from vacancies where title = 'Ext'",
     "authenticated", C, None),
    ("другой пользователь НЕ видит чужое письмо", True, "select count(*) from cover_letters", "authenticated", X, "0"),
    ("работодатель НЕ видит письма из кэша", True, "select count(*) from cover_letters", "authenticated", E, "0"),
    ("кандидат заменяет своё письмо («Переписать»)", True,
     f"""insert into cover_letters (user_id, vacancy_id, input_hash, text) select '{C}', id, 'h', 'v2' from vacancies where title = 'Ext'
         on conflict (user_id, vacancy_id, input_hash) do update set text = excluded.text returning text""",
     "authenticated", C, "v2"),

    # --- предпочтения кандидата и совпадение ---
    ("кандидат указывает, что ищет", True,
     "update profiles set pref_directions = '{backend}', pref_level = 'junior', pref_format = 'office', pref_city = 'Санкт-Петербург' where id = auth.uid()",
     "authenticated", C, None),
    ("неизвестное направление НЕ сохраняется", False,
     "update profiles set pref_directions = '{astronaut}' where id = auth.uid()", "authenticated", C, None),
    ("совпадение: подходящая вакансия высоко, чужое направление низко", True,
     "select string_agg(score::text, ',' order by score desc) from my_vacancy_matches(array(select id from vacancies where title in ('Ext') or title like 'Int%'))",
     "authenticated", C, "91,28"),
    ("подборка «Для вас»: лучшая вакансия первой", True,
     "select v.title from recommended_vacancies(1, 0) r join vacancies v on v.id = r.id", "authenticated", C,
     "Int Junior Python developer"),
    ("недостающие навыки берутся из стека вакансии", True,
     """update vacancies set stack = '["Python", "Kafka", "Docker"]' where title = 'Ext';
        select (m -> 'missing')::text || ' ' || (m -> 'matched')::text from vacancy_match((select v from vacancies v where title = 'Ext'), (select p from profiles p where id = '11111111-1111-1111-1111-111111111111')) m""",
     "postgres", None, '["Kafka", "Docker"] ["Python"]'),
    ("синонимы и смежные навыки: Postgres = PostgreSQL, MySQL ≈ PostgreSQL, PostgreSQL → SQL", True,
     """update profiles set skills = '["Postgres", "JS", "Cypress"]' where id = '11111111-1111-1111-1111-111111111111';
        update vacancies set stack = '["PostgreSQL", "JavaScript", "SQL", "Playwright", "Go"]' where title = 'Ext';
        select (m -> 'matched')::text || ' ' || (m -> 'missing')::text from vacancy_match((select v from vacancies v where title = 'Ext'), (select p from profiles p where id = '11111111-1111-1111-1111-111111111111')) m""",
     "postgres", None, '["PostgreSQL", "JavaScript", "SQL"] ["Go", {"via": "Cypress", "skill": "Playwright"}]'),
    ("смежный навык поднимает оценку, но меньше точного", True,
     """update vacancies set stack = '["Playwright"]' where title = 'Ext';
        create temp table scores (skills text, score int);
        update profiles set skills = '[]' where id = '11111111-1111-1111-1111-111111111111';
        insert into scores select 'none', (vacancy_match((select v from vacancies v where title = 'Ext'), (select p from profiles p where id = '11111111-1111-1111-1111-111111111111')) ->> 'score')::int;
        update profiles set skills = '["Go"]' where id = '11111111-1111-1111-1111-111111111111';
        insert into scores select 'other', (vacancy_match((select v from vacancies v where title = 'Ext'), (select p from profiles p where id = '11111111-1111-1111-1111-111111111111')) ->> 'score')::int;
        update profiles set skills = '["Cypress"]' where id = '11111111-1111-1111-1111-111111111111';
        insert into scores select 'related', (vacancy_match((select v from vacancies v where title = 'Ext'), (select p from profiles p where id = '11111111-1111-1111-1111-111111111111')) ->> 'score')::int;
        update profiles set skills = '["playwright"]' where id = '11111111-1111-1111-1111-111111111111';
        insert into scores select 'exact', (vacancy_match((select v from vacancies v where title = 'Ext'), (select p from profiles p where id = '11111111-1111-1111-1111-111111111111')) ->> 'score')::int;
        select ((select score from scores where skills = 'other') < (select score from scores where skills = 'related')
            and (select score from scores where skills = 'related') < (select score from scores where skills = 'exact'))::text;
        -- вернуть данные, на которые опираются следующие проверки
        update profiles set skills = '["Python"]' where id = '11111111-1111-1111-1111-111111111111';
        update vacancies set stack = '["Python", "Kafka", "Docker"]' where title = 'Ext';""",
     "postgres", None, "true"),
    ("опыт кандидата сравнивается с требуемым опытом напрямую", True,
     """update vacancies set experience_min = 3 where title = 'Ext';
        create temp table ex (years numeric, score int);
        update profiles set experience_years = 4 where id = '11111111-1111-1111-1111-111111111111';
        insert into ex select 4, (vacancy_match((select v from vacancies v where title = 'Ext'), (select p from profiles p where id = '11111111-1111-1111-1111-111111111111')) ->> 'score')::int;
        update profiles set experience_years = 1 where id = '11111111-1111-1111-1111-111111111111';
        insert into ex select 1, (vacancy_match((select v from vacancies v where title = 'Ext'), (select p from profiles p where id = '11111111-1111-1111-1111-111111111111')) ->> 'score')::int;
        select ((select score from ex where years = 4) - (select score from ex where years = 1))::text;
        update profiles set experience_years = null where id = '11111111-1111-1111-1111-111111111111';
        update vacancies set experience_min = null where title = 'Ext';""",
     "postgres", None, "15"),
    ("несколько форматов: подходит любой из выбранных", True,
     """update profiles set pref_formats = '{remote,hybrid}' where id = auth.uid();
        select pref_formats::text from profiles where id = auth.uid()""",
     "authenticated", C, "{remote,hybrid}"),
    ("неизвестный формат НЕ сохраняется", False,
     "update profiles set pref_formats = '{space}' where id = auth.uid()", "authenticated", C, None),
    ("работодателю подборка не считается", True,
     "select count(*) from recommended_vacancies(10, 0)", "authenticated", E, "0"),
    ("аноним НЕ вызывает подборку", False, "select * from recommended_vacancies(10, 0)", "anon", None, None),

    # --- избранное и скрытые ---
    ("кандидат сохраняет вакансию в избранное", True,
     f"insert into vacancy_marks (user_id, vacancy_id, kind) select '{C}', id, 'saved' from vacancies where title = 'Ext'",
     "authenticated", C, None),
    ("отметка НЕ ставится от чужого имени", False,
     f"insert into vacancy_marks (user_id, vacancy_id, kind) select '{X}', id, 'saved' from vacancies where title = 'Ext'",
     "authenticated", C, None),
    ("другой пользователь НЕ видит чужое избранное", True, "select count(*) from vacancy_marks", "authenticated", X, "0"),
    ("скрытая вакансия пропадает из подборки", True,
     f"""insert into vacancy_marks (user_id, vacancy_id, kind) select '{C}', id, 'hidden' from vacancies where title like 'Int%';
         select count(*) from recommended_vacancies(50, 0) r join vacancies v on v.id = r.id where v.title like 'Int%'""",
     "authenticated", C, "0"),
    ("кандидат снимает отметку", True,
     "delete from vacancy_marks where user_id = auth.uid() and kind = 'hidden' returning kind", "authenticated", C, "hidden"),

    # --- кабинет работодателя: ответ, просмотры, совпадение откликов ---
    ("работодатель отвечает кандидату текстом", True,
     "update applications set status = 'interview_scheduled', hr_message = 'Ждём вас во вторник' returning hr_message",
     "authenticated", E, "Ждём вас во вторник"),
    ("чужой работодатель НЕ пишет ответ", True,
     "update applications set hr_message = 'x' returning id", "authenticated", E2, ""),
    ("кандидат видит ответ работодателя", True,
     "select hr_message from applications", "authenticated", C, "Ждём вас во вторник"),
    ("аноним засчитывает просмотр вакансии", True,
     "select register_vacancy_view(id) from vacancies where title = 'Ext'; select views_count from vacancies where title = 'Ext'",
     "anon", None, "1"),
    ("свои просмотры работодатель НЕ накручивает", True,
     "select register_vacancy_view(id) from vacancies where title like 'Int%'; select views_count from vacancies where title like 'Int%'",
     "authenticated", E, "0"),
    ("аноним НЕ меняет счётчик напрямую", True,
     "update vacancies set views_count = 1000 returning id", "anon", None, ""),
    ("работодатель видит совпадение откликов на свои вакансии", True,
     "select count(*) from my_application_matches() where score between 0 and 100", "authenticated", E, "1"),
    ("чужой работодатель НЕ видит совпадение чужих откликов", True,
     "select count(*) from my_application_matches()", "authenticated", E2, "0"),

    # --- метрики для администратора ---
    ("обычный пользователь НЕ видит метрики", False, "select admin_metrics()", "authenticated", C, None),
    ("аноним НЕ видит метрики", False, "select admin_metrics()", "anon", None, None),
    ("пользователь НЕ читает список администраторов", False, "select count(*) from app_admins", "authenticated", C, None),
    ("администратор видит метрики", True,
     """insert into app_admins (email) values ('owner@example.com');
        set role authenticated; set request.jwt.claims = '{"email": "Owner@Example.com"}';
        select (admin_metrics() ->> 'vacancies_total')::int > 0 and jsonb_array_length(admin_metrics() -> 'vacancies_by_day') = 14""",
     "postgres", None, "t"),
    ("живой счётчик доступен гостю и не раскрывает каналы", True,
     "select (live_stats() ? 'total')::text || ':' || (live_stats() ? 'channels')::text", "anon", None, "true:true"),
    # --- исключение канала по просьбе владельца ---
    ("пользователь НЕ исключает каналы", False, "select exclude_channel('somechan')", "authenticated", C, None),
    ("аноним НЕ исключает каналы", False, "select exclude_channel('somechan')", "anon", None, None),
    ("администратор исключает канал: сбор выключен, вакансии в архиве, чужие на месте", True,
     """insert into app_admins (email) values ('owner@example.com') on conflict do nothing;
        insert into channels (username, is_active) values ('OptOutChan', true);
        insert into vacancies (title, source_type, source_post) values
          ('Opt 1', 'external', 'OptOutChan/1'), ('Opt 2', 'external', 'otherchan/1');
        set role authenticated; set request.jwt.claims = '{"email": "owner@example.com"}';
        select exclude_channel('@optoutchan', 'просьба владельца');
        select count(*) from excluded_channels() where username = 'OptOutChan';
        reset role;
        select (select is_active::text from channels where username = 'OptOutChan') || ':' ||
               (select string_agg((archived_at is not null)::text, ',' order by title) from vacancies where title like 'Opt %')""",
     "postgres", None, "1\n1\nfalse:true,false"),
    ("исключение канала, которого нет в списке, запоминается заранее", True,
     """insert into app_admins (email) values ('owner@example.com') on conflict do nothing;
        set role authenticated; set request.jwt.claims = '{"email": "owner@example.com"}';
        select exclude_channel('future_chan');
        reset role;
        select is_active::text || ':' || (excluded_at is not null)::text from channels where username = 'future_chan'""",
     "postgres", None, "0\nfalse:true"),
    # --- подписка в Telegram ---
    ("кандидат НЕ вписывает себе чужой chat_id", False,
     "update profiles set telegram_chat_id = 42 where id = auth.uid()", "authenticated", C, None),
    ("кандидат получает код привязки", True,
     "select length(create_telegram_link_code())", "authenticated", C, "32"),
    ("работодатель НЕ получает код привязки", False, "select create_telegram_link_code()", "authenticated", E, None),
    ("кандидат включает рассылку (свой флаг можно)", True,
     "update profiles set telegram_notify = true where id = auth.uid() returning telegram_notify", "authenticated", C, "t"),
    ("сборщик привязывает чат по коду, рассылка собирается", True,
     f"""update profiles set telegram_chat_id = 777 where telegram_link_code is not null;
         update vacancies set created_at = now() where title like 'Int%';
         select chat_id::text || ':' || jsonb_array_length(items) from telegram_digest(50)""",
     "service_role", None, "777:1"),
    ("пользователь НЕ вызывает рассылку", False, "select * from telegram_digest(0)", "authenticated", C, None),
    ("бот НЕ привязывает чат по чужому или неверному коду", True,
     "select link_telegram_chat('00000000000000000000000000000000', 5)::text || link_telegram_chat('abc', 5)::text",
     "anon", None, "falsefalse"),
    ("бот привязывает чат по коду кандидата, код одноразовый", True,
     f"""select from set_config('t.code', (select telegram_link_code from profiles where id = '{C}'), false);
         set role anon;
         select link_telegram_chat(current_setting('t.code'), 555)::text || link_telegram_chat(current_setting('t.code'), 556)::text;""",
     "postgres", None, "truefalse"),
    ("привязка записала чат и включила подборку", True,
     f"select telegram_chat_id::text || ':' || telegram_notify::text from profiles where id = '{C}'", "postgres", None, "555:true"),
    ("не администратор НЕ меняет имя бота", False, "select set_telegram_bot('evil_bot')", "authenticated", C, None),
    ("аноним читает имя бота, но не другие настройки", True,
     """insert into app_settings (key, value) values ('telegram_bot_username', 'fastcv_bot'), ('telegram_update_offset', '5') on conflict do nothing;
        set role anon; select string_agg(key, ',') from app_settings""",
     "postgres", None, "telegram_bot_username"),
    ("сборщик сохраняет настройки бота", True,
     """insert into app_settings (key, value) values ('telegram_update_offset', '9')
          on conflict (key) do update set value = excluded.value;
        select value from app_settings where key = 'telegram_update_offset'""",
     "service_role", None, "9"),
    ("16-й отклик за сутки НЕ проходит", False,
     f"""insert into vacancies (title, source_type) select 'Limit ' || i, 'external' from generate_series(1, 16) i;
         set role authenticated; set request.jwt.claim.sub = '{X}';
         insert into applications (vacancy_id, candidate_id, status)
           select id, '{X}', 'new' from vacancies where title like 'Limit %' order by title;""",
     "postgres", None, None),
    ("лимит НЕ мешает другим кандидатам, а отклики до лимита сохранены", True,
     f"""insert into vacancies (title, source_type) select 'Limit ' || i, 'external' from generate_series(1, 15) i;
         insert into applications (vacancy_id, candidate_id, status)
           select id, '{X}', 'new' from vacancies where title like 'Limit %' order by title;
         select count(*) from applications where candidate_id = '{X}';
         delete from applications where candidate_id = '{X}';
         delete from vacancies where title like 'Limit %';""",
     "postgres", None, "15"),
    ("время просмотра отклика ставит база, а не клиент", True,
     f"""insert into applications (vacancy_id, candidate_id, status, viewed_at)
           select id, '{X}', 'new', '2000-01-01' from vacancies limit 1;
         select (viewed_at is null)::text from applications where candidate_id = '{X}'""",
     "postgres", None, "true"),
    ("просмотр фиксируется один раз", True,
     f"""update applications set status = 'viewed' where candidate_id = '{X}';
         update applications set status = 'rejected', viewed_at = '2000-01-01' where candidate_id = '{X}';
         select (viewed_at > now() - interval '1 minute')::text from applications where candidate_id = '{X}'""",
     "postgres", None, "true"),
    ("повторная публикация в другом канале учитывается в свежести", True,
     """insert into vacancy_sightings (source_post, vacancy_id, channel, posted_at)
          select 'chan_a/1', id, 'chan_a', now() - interval '3 days' from vacancies where title = 'Ext';
        insert into vacancy_sightings (source_post, vacancy_id, channel, posted_at)
          select 'chan_b/7', id, 'chan_b', now() from vacancies where title = 'Ext';
        select channels_count::text || ':' || (first_seen_at < now() - interval '2 days')::text
          from vacancies where title = 'Ext'""",
     "service_role", None, "2:true"),
    ("сайт НЕ читает журнал публикаций напрямую", False, "select count(*) from vacancy_sightings", "anon", None, None),
    ("оценка зарплаты — только при 10+ похожих вакансиях с небольшим разбросом", True,
     """insert into vacancies (title, source_type, direction, level, salary_min, salary_max, salary_currency)
          select 'Bench ' || i, 'external', 'design', 'middle', 100000 + i * 5000, 140000 + i * 5000, 'RUB'
            from generate_series(1, 10) i;
        insert into vacancies (title, source_type, direction, level, salary_min, salary_currency)
          select 'Wide ' || i, 'external', 'hr', 'junior', case when i % 2 = 0 then 30000 else 400000 end, 'RUB'
            from generate_series(1, 12) i;
        select refresh_feed_stats();
        set role anon;
        select string_agg(direction || ':' || coalesce(level, '*') || ':' || sample, ',' order by all_levels)
          from salary_benchmarks where direction in ('design', 'hr')""",
     "postgres", None, "design:middle:10,design:*:10"),
    ("справочники городов и направлений обновляются пересчётом", True,
     """insert into vacancies (title, source_type, city, direction) values ('Stat', 'external', 'Стат-город', 'design');
        select refresh_feed_stats();
        set role anon;
        select (select vacancies::text from vacancy_cities where city = 'Стат-город') || ':' ||
               (select (vacancies > 0)::text from direction_counts where direction = 'design')""",
     "postgres", None, "1:true"),
    ("сайт НЕ запускает пересчёт справочников", False, "select refresh_feed_stats()", "anon", None, None),
    ("сайты компаний: ИТ в ленте наравне с Telegram, розница ниже", True,
     """insert into vacancies (title, source_type, source_post, ranking_weight) values
          ('Python-разработчик', 'external', 'career/x/1', 1.0),
          ('Менеджер по продажам', 'external', 'career/x/2', 1.0),
          ('Менеджер по продажам', 'external', 'tgchan/2', 1.0);
        select string_agg(ranking_weight::text, ',' order by source_post) from vacancies
         where source_post in ('career/x/1', 'career/x/2', 'tgchan/2')""",
     "postgres", None, "1,0.85,1"),
    ("направление ИТ-вакансий по названию", True,
     """select string_agg(vacancy_direction(t), ',' order by n) from (values
          (1, 'Старший DS-инженер в команду рекомендаций'),
          (2, 'Руководитель продуктового направления юнита рекламного кабинета'),
          (3, 'Старший инженер по серверным платформам'),
          (4, 'Тимлид команды платежей'),
          (5, 'Руководитель маркетинга продукта'),
          (6, 'Менеджер по продажам')) v(n, t)""",
     "postgres", None, "data_ml,product,backend,backend,marketing,sales"),
    ("направления: ИТ-руководство, фронтенд, DevOps, мобильная разработка, QA, геймдев", True,
     """select string_agg(vacancy_direction(t), ',' order by n) from (values
          (1, 'CTO в финтех-стартап'),
          (2, 'Руководитель отдела разработки'),
          (3, 'Руководитель отдела информационной безопасности'),
          (4, 'JavaScript-разработчик'),
          (5, 'Node.js / TypeScript backend developer'),
          (6, 'Системный инженер Linux'),
          (7, 'KMP-разработчик'),
          (8, 'Инженер по автотестам'),
          (9, 'Программист игр на C++'),
          (10, 'Тимлид команды платежей')) v(n, t)""",
     "postgres", None, "management,management,security,frontend,backend,devops,mobile,qa,gamedev,backend"),
    ("ИТ-вакансии «Работы России» и SuperJob живут 30 дней, остальные ротируются", True,
     """insert into vacancies (title, source_type, source_post, posted_at, direction) values
          ('IT tv dev', 'external', 'trudvsem/it1', now() - interval '5 days', 'devops'),
          ('IT tv old', 'external', 'trudvsem/it2', now() - interval '40 days', 'devops'),
          ('IT tv shop', 'external', 'trudvsem/it3', now() - interval '5 days', 'sales'),
          ('IT sj dev', 'external', 'superjob/it4', now() - interval '9 hours', 'frontend'),
          ('IT sj shop', 'external', 'superjob/it5', now() - interval '9 hours', 'sales');
        create temp table pr1 as select prune_trudvsem(2);
        create temp table pr2 as select prune_imported('superjob', 8);
        select string_agg(title, ',' order by title) from vacancies where title like 'IT %';
        delete from vacancies where title like 'IT %';""",
     "service_role", None, "IT sj dev,IT tv dev"),
    ("закрытые на SuperJob ИТ-вакансии убираются, открытые и чужие остаются", True,
     """insert into vacancies (title, source_type, source_post, posted_at, direction, created_at) values
          ('SC open', 'external', 'superjob/101', now() - interval '3 days', 'qa', now() - interval '2 days'),
          ('SC closed', 'external', 'superjob/102', now() - interval '3 days', 'qa', now() - interval '2 days'),
          ('SC shop', 'external', 'superjob/103', now() - interval '3 days', 'sales', now() - interval '2 days');
        create temp table pc as select prune_superjob_closed(array['101'], now() - interval '30 days') n;
        select (select n::text from pc) || ' ' || string_agg(title, ',' order by title) from vacancies where title like 'SC %';
        delete from vacancies where title like 'SC %';""",
     "service_role", None, "1 SC open,SC shop"),
    ("сайт НЕ удаляет вакансии SuperJob", False, "select prune_superjob_closed(array['1'], now())", "authenticated", C, None),
    ("страна вакансии: по городу, по ответу ИИ, по источнику", True,
     """insert into vacancies (title, source_type, source_post, city, country) values
          ('CO msk', 'external', 'tg/1', 'Москва', null),
          ('CO tash', 'external', 'tg/2', 'Ташкент', 'Россия'),
          ('CO ai', 'external', 'tg/3', null, 'Казахстан'),
          ('CO tv', 'external', 'trudvsem/co4', null, null),
          ('CO latin', 'external', 'tg/5', 'Springfield', null),
          ('CO town', 'external', 'tg/6', 'Старый Оскол', null),
          ('CO ats', 'external', 'career/jetbrains/7', null, null),
          ('CO site', 'external', 'career/tbank/8', null, null);
        update vacancies set city = 'Белград' where title = 'CO town';
        select string_agg(title || ':' || coalesce(country, '-'), ',' order by title) from vacancies where title like 'CO %';
        delete from vacancies where title like 'CO %';""",
     "postgres", None, "CO ai:Казахстан,CO ats:-,CO latin:-,CO msk:Россия,CO site:Россия,CO tash:Узбекистан,CO town:Сербия,CO tv:Россия"),
    ("сайт видит справочник стран", True, "select (count(*) >= 0)::text from vacancy_countries", "anon", None, "true"),
    ("функцию-триггер лимита откликов нельзя вызвать через API", False,
     "select limit_daily_applications()", "authenticated", C, None),
    ("работодатель не может сам вписать себе подтверждение компании", False,
     f"update profiles set company_verified_at = now() where id = '{E}'", "authenticated", E, None),
    ("работодатель не может сам поставить значок своей вакансии", True,
     f"""insert into vacancies (title, source_type, employer_id, employer_verified) values ('VB own', 'internal', '{E}', true);
        update vacancies set employer_verified = true where title = 'VB own';
        select employer_verified::text from vacancies where title = 'VB own'""",
     "authenticated", E, "false"),
    ("домен компании: почтовые сервисы не принимаются", False,
     "select start_company_verification('gmail.com')", "authenticated", E, None),
    ("домен компании: код для TXT-записи выдаётся работодателю", True,
     f"""create temp table cv as select start_company_verification('https://www.acme-corp.ru/jobs') c;
         select length(c)::text || ' ' || (select company_domain from profiles where id = '{E}') from cv""",
     "authenticated", E, "32 acme-corp.ru"),
    ("кандидат не подтверждает компанию", False,
     "select start_company_verification('acme.ru')", "authenticated", C, None),
    ("отклик без ответа 10 дней — вакансия работодателя ниже и со значком; ответил — всё вернулось", True,
     f"""insert into vacancies (id, title, source_type, employer_id) values ('99999999-0000-0000-0000-000000000001', 'AG job', 'internal', '{E}');
        insert into applications (vacancy_id, candidate_id, status, created_at)
          values ('99999999-0000-0000-0000-000000000001', '{C}', 'new', now() - interval '11 days');
        do $$ begin perform refresh_employer_slow(); end $$;
        create temp table ag1 as select employer_slow, ranking_weight from vacancies where title = 'AG job';
        update applications set status = 'rejected' where vacancy_id = '99999999-0000-0000-0000-000000000001';
        do $$ begin perform refresh_employer_slow(); end $$;
        select (select employer_slow::text || ':' || ranking_weight from ag1) || ' ' ||
               (select employer_slow::text || ':' || ranking_weight from vacancies where title = 'AG job');
        delete from applications where vacancy_id = '99999999-0000-0000-0000-000000000001';
        delete from vacancies where title = 'AG job';""",
     "postgres", None, "true:0.9 false:1.5"),
    ("работодатель не снимет значок «Отвечает редко» сам", True,
     f"""insert into vacancies (title, source_type, employer_id) values ('AG own', 'internal', '{E}');
        update vacancies set employer_slow = true, ranking_weight = 1.5 where title = 'AG own';
        select employer_slow::text from vacancies where title = 'AG own'""",
     "authenticated", E, "false"),
    ("рейтинг найма: доля ответов и типичное время до ответа", True,
     f"""insert into vacancies (id, title, source_type, employer_id) values ('99999999-0000-0000-0000-000000000002', 'HR job', 'internal', '{E}');
        insert into applications (vacancy_id, candidate_id, status, created_at)
          select '99999999-0000-0000-0000-000000000002', null, 'new', now() - interval '5 days' from generate_series(1, 5);
        update applications set status = 'rejected'
         where id in (select id from applications where vacancy_id = '99999999-0000-0000-0000-000000000002' limit 4);
        do $$ begin perform refresh_employer_slow(); end $$;
        select employer_stats::text from vacancies where title = 'HR job'""",
     "postgres", None, '{"rate": 80, "hours": 120}'),
    ("сборщик открывает опрос о собеседовании", True,
     f"""insert into applications (id, vacancy_id, candidate_id, status, created_at)
          values ('99999999-0000-0000-0000-0000000000a1', '99999999-0000-0000-0000-000000000002', '{C}', 'new', now() - interval '6 days');
        update applications set status = 'interview_scheduled' where id = '99999999-0000-0000-0000-0000000000a1';
        select length(start_interview_survey('99999999-0000-0000-0000-0000000000a1')::text)::text""",
     "service_role", None, "36"),
    ("работодатель НЕ видит секрет опроса", False,
     "select count(*) from interview_feedback", "authenticated", E, None),
    ("аноним НЕ видит опросы", False, "select count(*) from interview_feedback", "anon", None, None),
    ("работодатель НЕ оценивает собеседование за кандидата", True,
     "select rate_my_interview('99999999-0000-0000-0000-0000000000a1', 5)::text", "authenticated", E, "false"),
    ("работодатель НЕ оценивает по id отклика вместо секрета", True,
     "select rate_interview('99999999-0000-0000-0000-0000000000a1', 5)::text", "anon", None, "false"),
    ("работодатель НЕ запускает опрос сам", False,
     "select start_interview_survey('99999999-0000-0000-0000-0000000000a1')", "authenticated", E, None),
    ("кандидат оценивает собеседование по ссылке из бота", True,
     "select rate_interview((select token from interview_feedback where application_id = '99999999-0000-0000-0000-0000000000a1'), 4)::text",
     "postgres", None, "true"),
    ("кандидат меняет оценку на сайте и видит её", True,
     "do $$ begin perform rate_my_interview('99999999-0000-0000-0000-0000000000a1', 5); end $$; select rating::text from my_interview_ratings()",
     "authenticated", C, "5"),
    ("оценка вне 1–5 не принимается", False,
     "select rate_my_interview('99999999-0000-0000-0000-0000000000a1', 9)", "authenticated", C, None),
    ("от трёх оценок в сводке есть средняя", True,
     f"""insert into applications (id, vacancy_id, candidate_id, status) values
          ('99999999-0000-0000-0000-0000000000a2', '99999999-0000-0000-0000-000000000002', null, 'new'),
          ('99999999-0000-0000-0000-0000000000a3', '99999999-0000-0000-0000-000000000002', null, 'new');
        update applications set status = 'interview_scheduled' where id in ('99999999-0000-0000-0000-0000000000a2', '99999999-0000-0000-0000-0000000000a3');
        insert into interview_feedback (application_id, rating, rated_at) values
          ('99999999-0000-0000-0000-0000000000a2', 4, now()), ('99999999-0000-0000-0000-0000000000a3', 4, now());
        do $$ begin perform refresh_employer_slow(); end $$;
        select (employer_stats ->> 'rating') || ' ' || (employer_stats ->> 'ratings') from vacancies where title = 'HR job';
        delete from applications where vacancy_id = '99999999-0000-0000-0000-000000000002';
        delete from vacancies where title = 'HR job';""",
     "postgres", None, "4.3 3"),
    ("повторная публикация: индекс свежести помнит последнее появление", True,
     """insert into vacancies (id, title, source_type, source_post) values ('99999999-0000-0000-0000-0000000000b1', 'GH ext', 'external', 'ch/1');
        insert into vacancy_sightings (source_post, vacancy_id, channel, posted_at) values
          ('ch/1', '99999999-0000-0000-0000-0000000000b1', 'ch', now() - interval '20 days'),
          ('other/7', '99999999-0000-0000-0000-0000000000b1', 'other', now() - interval '1 day');
        select extract(day from last_seen_at - first_seen_at)::text || ' ' || channels_count from vacancies where title = 'GH ext'""",
     "service_role", None, "19 2"),
    ("аноним НЕ отмечает вакансию закрытой", False,
     "select report_vacancy_closed('99999999-0000-0000-0000-0000000000b1')", "anon", None, None),
    ("кандидат отмечает вакансию закрытой; повтор не считается", True,
     "do $$ begin perform report_vacancy_closed('99999999-0000-0000-0000-0000000000b1'); end $$; select report_vacancy_closed('99999999-0000-0000-0000-0000000000b1')::text || ' ' || my_closed_report('99999999-0000-0000-0000-0000000000b1')::text",
     "authenticated", C, "1 true"),
    ("работодатель НЕ читает, кто отметил", False,
     "select count(*) from vacancy_closed_reports", "authenticated", E, None),
    ("три отметки — внешняя вакансия уходит в архив", True,
     f"""set role authenticated; set request.jwt.claim.sub = '{X}';
        select report_vacancy_closed('99999999-0000-0000-0000-0000000000b1');
        set request.jwt.claim.sub = '{E2}';
        select report_vacancy_closed('99999999-0000-0000-0000-0000000000b1');
        reset role;
        select closed_reports || ' ' || (archived_at is not null)::text from vacancies where title = 'GH ext'""",
     "postgres", None, "2\n3\n3 true"),
    ("вакансия работодателя от отметок только получает значок, сам он счётчик не сбросит", True,
     f"""insert into vacancies (id, title, source_type, employer_id) values ('99999999-0000-0000-0000-0000000000b2', 'GH own', 'internal', '{E}');
        set role authenticated;
        set request.jwt.claim.sub = '{C}'; select report_vacancy_closed('99999999-0000-0000-0000-0000000000b2');
        set request.jwt.claim.sub = '{X}'; select report_vacancy_closed('99999999-0000-0000-0000-0000000000b2');
        set request.jwt.claim.sub = '{E2}'; select report_vacancy_closed('99999999-0000-0000-0000-0000000000b2');
        set request.jwt.claim.sub = '{E}'; update vacancies set closed_reports = 0 where title = 'GH own';
        reset role;
        select closed_reports || ' ' || (archived_at is null)::text from vacancies where title = 'GH own'""",
     "postgres", None, "1\n2\n3\n3 true"),
    ("работодатель не отмечает закрытой свою вакансию", False,
     "select report_vacancy_closed('99999999-0000-0000-0000-0000000000b2')", "authenticated", E, None),
    ("работодатель задаёт до трёх вопросов блица; пустые отбрасываются", True,
     f"""insert into vacancies (id, title, source_type, employer_id, blitz_questions)
          values ('99999999-0000-0000-0000-0000000000c1', 'BZ job', 'internal', '{E}', '["  Почему мы?  ", "", "Опыт с Kafka?"]');
        select blitz_questions::text from vacancies where title = 'BZ job'""",
     "authenticated", E, '["Почему мы?", "Опыт с Kafka?"]'),
    ("четыре вопроса блица — нельзя", False,
     """update vacancies set blitz_questions = '["a", "b", "c", "d"]' where title = 'BZ job'""", "authenticated", E, None),
    ("внешняя вакансия без блица", True,
     """insert into vacancies (title, source_type, blitz_questions) values ('BZ ext', 'external', '["x"]');
        select blitz_questions::text from vacancies where title = 'BZ ext'""", "service_role", None, "[]"),
    ("отклик без ответов на блиц не принимается", False,
     f"insert into applications (vacancy_id, candidate_id) values ('99999999-0000-0000-0000-0000000000c1', '{C}')",
     "authenticated", C, None),
    ("отклик с одним пустым ответом не принимается", False,
     f"""insert into applications (vacancy_id, candidate_id, blitz_answers) values ('99999999-0000-0000-0000-0000000000c1', '{C}', '["Интересно", " "]')""",
     "authenticated", C, None),
    ("кандидат отвечает на блиц — в базе пары вопрос-ответ", True,
     f"""insert into applications (id, vacancy_id, candidate_id, blitz_answers, blitz_summary)
          values ('99999999-0000-0000-0000-0000000000c2', '99999999-0000-0000-0000-0000000000c1', '{C}', '["Нравится продукт", "2 года"]', 'подделка');
        select blitz_answers::text || ' ' || coalesce(blitz_summary, 'нет') from applications where id = '99999999-0000-0000-0000-0000000000c2'""",
     "authenticated", C, '[{"a": "Нравится продукт", "q": "Почему мы?"}, {"a": "2 года", "q": "Опыт с Kafka?"}] нет'),
    ("работодатель НЕ правит ответы кандидата", False,
     """update applications set blitz_answers = '[]' where id = '99999999-0000-0000-0000-0000000000c2'""", "authenticated", E, None),
    ("работодатель сохраняет ИИ-выжимку ответов", True,
     """update applications set blitz_summary = 'Мотивирован, опыт 2 года' where id = '99999999-0000-0000-0000-0000000000c2';
        select blitz_summary from applications where id = '99999999-0000-0000-0000-0000000000c2'""",
     "authenticated", E, "Мотивирован, опыт 2 года"),
    ("сброс демо: следы показа стираются, вакансии и профиль — заново", True,
     """insert into auth.users values ('00000000-0000-0000-0000-0000000000e1', '{"role":"candidate"}'),
                                      ('00000000-0000-0000-0000-0000000000e2', '{"role":"employer"}');
        do $$ begin perform reset_demo('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2'); end $$;
        insert into applications (vacancy_id, candidate_id, blitz_answers)
          select id, '00000000-0000-0000-0000-0000000000e1', '["Бронирование", "Через 2 недели"]'
            from vacancies where employer_id = '00000000-0000-0000-0000-0000000000e2' and title like 'Python%';
        insert into vacancy_marks (user_id, vacancy_id, kind)
          select '00000000-0000-0000-0000-0000000000e1', id, 'saved' from vacancies where title = 'Ext';
        create temp table dr as select reset_demo('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2') r;
        select (select r::text from dr) || ' ' ||
               (select count(*) from applications where candidate_id = '00000000-0000-0000-0000-0000000000e1') || ' ' ||
               (select count(*) from vacancy_marks where user_id = '00000000-0000-0000-0000-0000000000e1') || ' ' ||
               (select string_agg(jsonb_array_length(blitz_questions)::text, ',' order by title desc)
                  from vacancies where employer_id = '00000000-0000-0000-0000-0000000000e2') || ' ' ||
               (select name || ':' || coalesce(pref_level, '-') || ':' || jsonb_array_length(skills) from profiles where id = '00000000-0000-0000-0000-0000000000e1')""",
     "postgres", None,
     '{"vacancies_created": 3, "vacancies_replaced": 3, "applications_removed": 1} 0 0 0,2,0 Анна Смирнова:-:0'),
    ("сервис (скрипт) вызывает сброс демо", True,
     "select reset_demo('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2') ->> 'vacancies_created'",
     "service_role", None, "3"),
    ("сброс демо не перепутает роли", False,
     "select reset_demo('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1')", "service_role", None, None),
    ("сайт НЕ вызывает сброс демо", False,
     "select reset_demo('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2')", "authenticated", E, None),
    ("аудит безопасности: в базе нет ничего сверх осознанных исключений", True,
     # pgcrypto в public — особенность тестовой базы (на Supabase он в extensions)
     """select coalesce(jsonb_agg(x), '[]')::text from jsonb_array_elements(security_audit()) x
         where x ->> 'kind' <> 'extension_public'""", "service_role", None, "[]"),
    ("аудит находит новую публичную функцию и таблицу без RLS", True,
     """create function public.audit_probe() returns int language sql security definer as $$ select 1 $$;
        grant execute on function public.audit_probe() to anon;
        create table public.audit_probe_t (id int);
        select string_agg(x ->> 'kind', ',' order by x ->> 'kind') from jsonb_array_elements(security_audit()) x
         where x ->> 'name' like 'audit_probe%';
        drop function public.audit_probe(); drop table public.audit_probe_t;""",
     "postgres", None, "anon_definer,auth_definer,no_rls,search_path"),
    ("сайт НЕ вызывает аудит", False, "select security_audit()", "authenticated", E, None),
    ("отклик на вакансию работодателя открывает чат: первым сообщением — письмо и ответы", True,
     f"""insert into vacancies (id, title, source_type, employer_id, blitz_questions)
          values ('99999999-0000-0000-0000-0000000000d1', 'CH job', 'internal', '{E}', '["Опыт?"]');
        set role authenticated; set request.jwt.claim.sub = '{C}';
        insert into applications (id, vacancy_id, candidate_id, cover_letter, blitz_answers)
          values ('99999999-0000-0000-0000-0000000000d2', '99999999-0000-0000-0000-0000000000d1', '{C}', 'Здравствуйте!', '["3 года"]');
        reset role;
        select m.kind || ':' || m.body || ':' || (m.meta -> 'blitz' -> 0 ->> 'a') || ':' || (m.sender_id = '{C}')::text
          from messages m join conversations c on c.id = m.conversation_id where c.application_id = '99999999-0000-0000-0000-0000000000d2'""",
     "postgres", None, "application:Здравствуйте!:3 года:true"),
    ("отклик на вакансию из Telegram — без чата", True,
     f"""insert into applications (vacancy_id, candidate_id) select id, '{C}' from vacancies where title = 'Ext';
        select count(*)::text from conversations c join applications a on a.id = c.application_id
         join vacancies v on v.id = a.vacancy_id where v.title = 'Ext'""",
     "postgres", None, "0"),
    ("работодатель видит отклик в чате как непрочитанный", True,
     "select (unread_conversations() >= 1)::text || ' ' || (select unread || ':' || other_name || ':' || i_am from my_conversations() where vacancy_title = 'CH job')",
     "authenticated", E, "true 1:Иван:employer"),
    ("работодатель отвечает в чат, у кандидата непрочитанное", True,
     f"""do $$ begin perform mark_conversation_read((select id from conversations where application_id = '99999999-0000-0000-0000-0000000000d2')); end $$;
        do $$ begin perform send_message((select id from conversations where application_id = '99999999-0000-0000-0000-0000000000d2'), '  Добрый день! Удобно созвониться завтра?  '); end $$;
        select (select unread from my_conversations() where vacancy_title = 'CH job')::text || ' ' ||
               (select body from messages where kind = 'text' order by id desc limit 1)""",
     "authenticated", E, "0 Добрый день! Удобно созвониться завтра?"),
    ("кандидат видит ответ непрочитанным и отвечает", True,
     f"""create temp table u as select unread from my_conversations() where vacancy_title = 'CH job';
        do $$ begin perform send_message((select id from conversations where application_id = '99999999-0000-0000-0000-0000000000d2'), 'Да, после 14:00'); end $$;
        select (select unread from u)::text || ' ' || (select unread from my_conversations() where vacancy_title = 'CH job')::text
               || ' ' || (select last_mine::text from my_conversations() where vacancy_title = 'CH job')""",
     "authenticated", C, "1 0 true"),
    ("посторонний НЕ видит чужой диалог и сообщения", True,
     """select (select count(*) from conversations where application_id = '99999999-0000-0000-0000-0000000000d2')::text || ' ' ||
               (select count(*) from messages m where not exists (select 1 from conversations c where c.id = m.conversation_id))::text""",
     "authenticated", X, "0 0"),
    ("посторонний НЕ пишет в чужой диалог", False,
     f"select send_message((select id from conversations where application_id = '99999999-0000-0000-0000-0000000000d2'), 'спам')",
     "service_role", None, None),
    ("участник НЕ пишет в чат напрямую в таблицу", False,
     f"insert into messages (conversation_id, sender_id, body) select id, '{C}', 'обход' from conversations where application_id = '99999999-0000-0000-0000-0000000000d2'",
     "authenticated", C, None),
    ("пустое сообщение не отправляется", False,
     f"select send_message((select id from conversations where application_id = '99999999-0000-0000-0000-0000000000d2'), '   ')", "authenticated", C, None),
    ("приглашение из кабинета приходит в чат сообщением", True,
     f"""update applications set status = 'interview_scheduled', hr_message = 'Ждём во вторник' where id = '99999999-0000-0000-0000-0000000000d2';
        select kind || ':' || body || ':' || (meta ->> 'status') from messages
         where conversation_id = (select id from conversations where application_id = '99999999-0000-0000-0000-0000000000d2') order by id desc limit 1""",
     "authenticated", E, "status:Ждём во вторник:interview_scheduled"),
    ("лимит: не больше 20 сообщений в минуту", False,
     f"""do $$ begin for i in 1..25 loop perform send_message((select id from conversations where application_id = '99999999-0000-0000-0000-0000000000d2'), 'msg ' || i); end loop; end $$;""",
     "authenticated", C, None),
    ("очередь уведомлений о непрочитанном — только сервису и через 15 минут", True,
     f"""update messages set created_at = now() - interval '20 minutes'
          where conversation_id = (select id from conversations where application_id = '99999999-0000-0000-0000-0000000000d2');
        update conversations set candidate_read_at = null, employer_read_at = now(), candidate_notified_at = null
          where application_id = '99999999-0000-0000-0000-0000000000d2';
        select string_agg(side || ':' || unread, ',' order by side) from pending_chat_notifications()
         where conversation_id = (select id from conversations where application_id = '99999999-0000-0000-0000-0000000000d2')""",
     "postgres", None, "candidate:2"),
    ("сайт НЕ читает очередь уведомлений чата с адресами", False,
     "select * from pending_chat_notifications()", "authenticated", C, None),
    ("удаление отклика удаляет и чат", True,
     f"""delete from applications where id = '99999999-0000-0000-0000-0000000000d2';
        select (select count(*) from conversations where application_id = '99999999-0000-0000-0000-0000000000d2')::text;
        delete from vacancies where id = '99999999-0000-0000-0000-0000000000d1';""",
     "postgres", None, "0"),
    ("ротация «Работы России»: старые удаляются, с откликами — в архив, свежие остаются", True,
     f"""insert into vacancies (title, source_type, source_post, posted_at) values
          ('TV old', 'external', 'trudvsem/old', now() - interval '5 days'),
          ('TV applied', 'external', 'trudvsem/applied', now() - interval '5 days'),
          ('TV fresh', 'external', 'trudvsem/fresh', now());
        insert into applications (vacancy_id, candidate_id, status) select id, '{C}', 'new' from vacancies where title = 'TV applied';
        create temp table pr as select prune_trudvsem(2)::text as r;
        select (select r from pr) || ' ' ||
               (select string_agg(title || ':' || (archived_at is not null)::text, ',' order by title) from vacancies where title like 'TV %');
        delete from applications where vacancy_id in (select id from vacancies where title like 'TV %');
        delete from vacancies where title like 'TV %';""",
     "service_role", None, '{"removed": 1, "archived": 1} TV applied:true,TV fresh:false'),
    ("сайт НЕ вызывает ротацию", False, "select prune_trudvsem(2)", "authenticated", C, None),
    ("ротация SuperJob по часам: старше окна удаляются, свежие и чужие источники остаются", True,
     """insert into vacancies (title, source_type, source_post, posted_at) values
          ('SJ old', 'external', 'superjob/old', now() - interval '9 hours'),
          ('SJ fresh', 'external', 'superjob/fresh', now() - interval '1 hour'),
          ('SJ other', 'external', 'trudvsem/sj-other', now() - interval '9 hours');
        create temp table pr as select prune_imported('superjob', 8)::text as r;
        select (select r from pr) || ' ' ||
               (select string_agg(title, ',' order by title) from vacancies where title like 'SJ %');
        delete from vacancies where title like 'SJ %';""",
     "service_role", None, '{"removed": 1, "archived": 0} SJ fresh,SJ other'),
    ("ротация — только известные источники", False, "select prune_imported('', 1)", "service_role", None, None),
    ("источник вакансии проставляется сам: telegram, career, superjob, trudvsem, employer", True,
     f"""insert into vacancies (title, source_type, source_post) values
          ('SK tg', 'external', 'somechannel/1'), ('SK career', 'external', 'career/acme/1'),
          ('SK sj', 'external', 'superjob/1'), ('SK tv', 'external', 'trudvsem/1');
        insert into vacancies (title, source_type, employer_id) values ('SK emp', 'internal', '{E}');
        select string_agg(title || ':' || source_kind, ',' order by title) from vacancies where title like 'SK %';
        delete from vacancies where title like 'SK %';""",
     "postgres", None, "SK career:career,SK emp:employer,SK sj:superjob,SK tg:telegram,SK tv:trudvsem"),
    ("вакансии с сайтов компаний не уходят в архив по возрасту — только когда пропали с сайта", True,
     """insert into vacancies (title, source_type, source_post, posted_at) values
          ('CR old', 'external', 'career/acme/1', now() - interval '60 days'),
          ('CR tg', 'external', 'somechannel/777', now() - interval '60 days');
        create temp table a as select archive_stale_vacancies(30) n;
        select string_agg(title || ':' || (archived_at is not null)::text, ',' order by title) from vacancies where title like 'CR %';
        delete from vacancies where title like 'CR %';""",
     "postgres", None, "CR old:false,CR tg:true"),
    ("сайт НЕ вызывает ротацию SuperJob", False, "select prune_imported('superjob', 8)", "authenticated", C, None),
    ("тип нанимателя — только из списка", False,
     "update vacancies set hiring_type = 'friends' where title = 'Ext'", "service_role", None, None),
    ("у каждого правила RLS есть права на таблицу для его роли", True,
     """select coalesce(string_agg(c.relname || ':' || p.polname || ':' || r::regrole::text, ' '), 'ok')
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
          cross join lateral unnest(p.polroles) r
         where not has_table_privilege(r, c.oid,
                 case p.polcmd when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'select' end)""",
     "postgres", None, "ok"),
    ("очередь писем: новый отклик — работодателю, приглашение — кандидату; после отметки пусто", True,
     f"""update auth.users set email = 'c@example.com' where id = '{C}';
        update auth.users set email = 'e@example.com' where id = '{E}';
        insert into vacancies (title, source_type, employer_id) values ('NQ vacancy', 'internal', '{E}');
        insert into applications (vacancy_id, candidate_id, status) select id, '{C}', 'new' from vacancies where title = 'NQ vacancy';
        insert into applications (vacancy_id, candidate_id, status, candidate_notified_status, employer_notified_at, hr_replied_at)
          select id, '{C}', 'interview_scheduled', 'new', now(), now() from vacancies where title = 'NQ vacancy';
        create temp table q as select * from pending_notifications() where vacancy_title = 'NQ vacancy';
        create temp table m as
          select mark_notified('employer_new', array(select application_id from q where kind = 'employer_new')) a,
                 mark_notified('candidate_status', array(select application_id from q where kind = 'candidate_status')) b;
        create temp table q2 as select * from pending_notifications() where vacancy_title = 'NQ vacancy';
        select (select string_agg(kind || ':' || email, ',' order by kind) from q) || ' / ' || (select count(*) from q2);
        delete from applications where vacancy_id in (select id from vacancies where title = 'NQ vacancy');
        delete from vacancies where title = 'NQ vacancy';""",
     "postgres", None, "candidate_status:c@example.com,employer_new:e@example.com / 0"),
    ("сборщик (service_role) читает очередь писем", True, "select count(*) >= 0 from pending_notifications()", "service_role", None, "t"),
    ("напоминание работодателю: отклик без ответа неделю — один раз; отвеченный — нет", True,
     f"""update auth.users set email = 'e@example.com' where id = '{E}';
        insert into vacancies (title, source_type, employer_id) values ('RM vacancy', 'internal', '{E}');
        insert into applications (vacancy_id, candidate_id, status, created_at, employer_notified_at)
          select id, '{C}', 'viewed', now() - interval '8 days', now() from vacancies where title = 'RM vacancy';
        insert into applications (vacancy_id, candidate_id, status, created_at, employer_notified_at, hr_replied_at)
          select id, '{C}', 'rejected', now() - interval '8 days', now(), now() - interval '7 days' from vacancies where title = 'RM vacancy';
        create temp table q as select * from pending_notifications() where vacancy_title = 'RM vacancy' and kind = 'employer_reminder';
        create temp table m as select mark_notified('employer_reminder', array(select application_id from q)) n;
        select (select count(*) from q) || ' ' || (select count(*) from pending_notifications() where vacancy_title = 'RM vacancy' and kind = 'employer_reminder');
        delete from applications where vacancy_id in (select id from vacancies where title = 'RM vacancy');
        delete from vacancies where title = 'RM vacancy';""",
     "postgres", None, "1 0"),
    ("сайт НЕ читает очередь писем с адресами", False, "select * from pending_notifications()", "authenticated", C, None),
    ("аноним не может удалить аккаунт", False, "select delete_my_account()", "anon", None, None),
    ("пользователь удаляет свой аккаунт целиком, чужие данные на месте", True,
     """insert into auth.users values ('00000000-0000-0000-0000-0000000000d1', '{"role":"candidate"}');
        update profiles set name = 'Del' where id = '00000000-0000-0000-0000-0000000000d1';  -- профиль создаёт триггер
        insert into vacancy_marks (user_id, vacancy_id, kind) select '00000000-0000-0000-0000-0000000000d1', id, 'saved' from vacancies limit 1;
        set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
        select delete_my_account();
        reset role;
        select (select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000d1')
             + (select count(*) from profiles where id = '00000000-0000-0000-0000-0000000000d1')
             + (select count(*) from vacancy_marks where user_id = '00000000-0000-0000-0000-0000000000d1')
             || ' ' || ((select count(*) from profiles) > 0)::text""",
     "postgres", None, "0 true"),
    ("кандидат отвязывает Telegram", True,
     "select unlink_telegram(); select coalesce(telegram_chat_id::text, 'нет') from profiles where id = auth.uid()",
     "authenticated", C, "нет"),
]


@pytest.mark.parametrize("name,should_pass,sql,role,uid,expected", CHECKS, ids=[c[0] for c in CHECKS])
def test_access_rule(name, should_pass, sql, role, uid, expected):
    ok, out = psql(sql, role=role, uid=uid)
    assert ok == should_pass, f"{'ошибка' if not ok else 'прошёл, хотя не должен'}: {out}"
    if expected is not None:
        assert out == expected
