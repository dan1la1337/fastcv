#!/bin/bash
# Проверка 03-migrate.sh без серверов: две базы на одном локальном Postgres.
# «Источник» — заглушки Supabase (tests/db/stub.sql) + все миграции + тестовые данные,
# «новая база» — только заглушки; дальше schema → data → verify, как на настоящем переносе.
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres bash infra/ru-migration/test-local.sh
#
# Запускается в CI (tests.yml, задача database) — перенос проверяется при каждой новой миграции.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC=fastcv_mig_src
DST=fastcv_mig_dst
q() { psql -v ON_ERROR_STOP=1 -XtAq "$@"; }

# Заглушки поверх tests/db/stub.sql: то, что migrate.sh читает в настоящем Supabase
EXTRA_STUB="
create table if not exists auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text);
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
"

stub_file() {  # роли общие на кластер: создаём их только один раз
    local roles
    roles="$(q -d postgres -c "select count(*) from pg_roles where rolname = 'authenticated'")"
    if [ "$roles" = 1 ]; then grep -v '^create role' "$ROOT/tests/db/stub.sql"; else cat "$ROOT/tests/db/stub.sql"; fi
    echo "$EXTRA_STUB"
}

for db in $SRC $DST; do
    q -d postgres -c "drop database if exists $db" -c "create database $db"
    stub_file | q -d $db
done

echo "▶ источник: миграции и данные"
for f in "$ROOT"/supabase/migrations/*.sql; do q -d $SRC -f "$f" > /dev/null; done
q -d $SRC <<'SQL'
insert into auth.users (id, raw_user_meta_data, email) values
  ('11111111-1111-1111-1111-111111111111', '{"role":"candidate"}', 'c@example.com'),
  ('22222222-2222-2222-2222-222222222222', '{"role":"employer"}', 'e@example.com');
insert into auth.identities (user_id, provider) select id, 'email' from auth.users;
update profiles set name = 'Тестовый Кандидат', description = 'Java, Spring' where id = '11111111-1111-1111-1111-111111111111';
insert into vacancies (title, source_type) values ('Java Developer', 'external'), ('QA Engineer', 'external');
insert into vacancies (title, source_type, employer_id) values ('Middle Python', 'internal', '22222222-2222-2222-2222-222222222222');
insert into applications (vacancy_id, candidate_id, cover_letter)
  select id, '11111111-1111-1111-1111-111111111111', 'Здравствуйте' from vacancies where title = 'Middle Python';
SQL

export PG_LOCAL=1 WORK="$(mktemp -d)"
base="postgresql://${PGUSER:-postgres}:${PGPASSWORD:-}@${PGHOST:-localhost}:${PGPORT:-5432}"
export SRC_DB_URL="$base/$SRC" DST_DB_URL="$base/$DST"
M="$ROOT/infra/ru-migration/03-migrate.sh"

bash "$M" schema
bash "$M" data
bash "$M" data          # повтор (финальная синхронизация) — не должен ломаться и задваивать
bash "$M" verify

# Пользователь, его профиль и отклик доехали; вакансия работодателя — с тем же id
[ "$(q -d $DST -c "select name from profiles where id = '11111111-1111-1111-1111-111111111111'")" = "Тестовый Кандидат" ]
[ "$(q -d $DST -c "select count(*) from applications")" = 1 ]
[ "$(q -d $SRC -c "select id from vacancies where title = 'Middle Python'")" = "$(q -d $DST -c "select id from vacancies where title = 'Middle Python'")" ]
# Последовательности перенесены: новая запись не конфликтует с перенесёнными
q -d $DST -c "insert into vacancies (title, source_type) values ('После переноса', 'external')"

rm -rf "$WORK"
q -d postgres -c "drop database $SRC" -c "drop database $DST"
echo "✅ перенос проверен"
