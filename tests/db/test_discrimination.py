"""Вакансии с дискриминационными требованиями не попадают в публичную ленту.

Политика vacancies_hide_discriminatory (миграция 20261118030000_discrimination_flags.sql):
флаги age, sex, nationality скрывают вакансию от всех, кроме автора и откликнувшихся
кандидатов; citizenship только помечает. Запуск и переменные — как у test_rls.py.
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

C = "11111111-1111-1111-1111-111111111111"   # кандидат, откликнулся на вакансию «Age»
E = "22222222-2222-2222-2222-222222222222"   # работодатель, автор вакансии «Own»
X = "33333333-3333-3333-3333-333333333333"   # другой кандидат


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
    """Чистая база с заглушками Supabase и всеми миграциями (как в test_rls.py) и тестовые вакансии."""
    for sql in (f"drop database if exists {DB}", f"create database {DB}"):
        ok, out = psql(sql, db="postgres")
        assert ok, out
    ok, out = psql("select count(*) from pg_roles where rolname = 'authenticated'")
    stub = (ROOT / "tests/db/stub.sql").read_text()
    if out == "1":
        stub = "\n".join(line for line in stub.splitlines() if not line.startswith("create role"))
    tmp = ROOT / "tests/db/.stub_discrimination.sql"
    tmp.write_text(stub)
    try:
        ok, out = psql("", file=tmp)
        assert ok, out
    finally:
        tmp.unlink()
    migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    # Миграция флагов — дважды: она обязана быть повторяемой
    for migration in [*migrations, *[m for m in migrations if "discrimination" in m.name]]:
        ok, out = psql("", file=migration)
        assert ok, f"{migration.name}: {out}"
    ok, out = psql(f"""
        insert into auth.users values ('{C}', '{{"role":"candidate"}}'), ('{E}', '{{"role":"employer"}}'), ('{X}', '{{}}');
        insert into vacancies (title, source_type, discrimination_flags) values
          ('Clean', 'external', '{{}}'),
          ('Age', 'external', '{{age}}'),
          ('Sex', 'external', '{{sex}}'),
          ('Nationality', 'external', '{{nationality}}'),
          ('Citizenship', 'external', '{{citizenship}}');
        insert into vacancies (title, source_type, employer_id, ranking_weight, discrimination_flags)
          values ('Own', 'internal', '{E}', 1.5, '{{sex,citizenship}}');
        insert into applications (vacancy_id, candidate_id) select id, '{C}' from vacancies where title = 'Age';
    """)
    assert ok, out
    yield


FEED = "select string_agg(title, ',' order by title) from vacancies where archived_at is null"


def test_column_shape():
    ok, out = psql("""select data_type || ',' || is_nullable || ',' || column_default from information_schema.columns
                       where table_schema = 'public' and table_name = 'vacancies' and column_name = 'discrimination_flags'""")
    assert ok, out
    assert out == "ARRAY,NO,'{}'::text[]"


def test_new_vacancy_has_no_flags():
    ok, out = psql("insert into vacancies (title, source_type) values ('Default', 'external') returning discrimination_flags")
    assert ok, out
    assert out.splitlines()[0] == "{}"
    psql("delete from vacancies where title = 'Default'")


@pytest.mark.parametrize("role,uid", [("anon", None), ("authenticated", X)], ids=["anon", "other candidate"])
def test_feed_hides_age_sex_nationality_but_keeps_citizenship(role, uid):
    ok, out = psql(FEED, role=role, uid=uid)
    assert ok, out
    assert out == "Citizenship,Clean"


def test_feed_by_id_does_not_leak_hidden_vacancy():
    ok, out = psql("select count(*) from vacancies where title = 'Age'", role="anon")
    assert ok, out
    assert out == "0"


def test_author_sees_own_flagged_vacancy():
    ok, out = psql(FEED, role="authenticated", uid=E)
    assert ok, out
    assert out == "Citizenship,Clean,Own"


def test_applicant_keeps_access_to_vacancy_they_applied_to():
    ok, out = psql(FEED, role="authenticated", uid=C)
    assert ok, out
    assert out == "Age,Citizenship,Clean"


def test_recommendations_skip_hidden_vacancies():
    ok, out = psql("select string_agg(v.title, ',' order by v.title) from recommended_vacancies(50, 0) r join vacancies v on v.id = r.id",
                   role="authenticated", uid=X)
    assert ok, out
    assert out == "Citizenship,Clean"


def test_scraper_still_sees_everything():
    ok, out = psql("select count(*) from vacancies", role="service_role")
    assert ok, out
    assert out == "6"
