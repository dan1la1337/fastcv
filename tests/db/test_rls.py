"""Правила доступа к базе (RLS) на чистом Postgres со схемой supabase/schema.sql.

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
    for attempt in (1, 2):
        ok, out = psql("", file=ROOT / "supabase/schema.sql")
        assert ok, f"schema.sql, запуск {attempt}: {out}"
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
    ("работодатель НЕ задирает ranking_weight", False,
     f"insert into vacancies (title, source_type, employer_id, ranking_weight) values ('Top', 'internal', '{E}', 100)",
     "authenticated", E, None),
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
    ("пользователь НЕ читает журнал вызовов ИИ", True, "select count(*) from ai_usage", "authenticated", C, "0"),

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
]


@pytest.mark.parametrize("name,should_pass,sql,role,uid,expected", CHECKS, ids=[c[0] for c in CHECKS])
def test_access_rule(name, should_pass, sql, role, uid, expected):
    ok, out = psql(sql, role=role, uid=uid)
    assert ok == should_pass, f"{'ошибка' if not ok else 'прошёл, хотя не должен'}: {out}"
    if expected is not None:
        assert out == expected
