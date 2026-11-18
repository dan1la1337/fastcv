#!/bin/bash
# Шаг 3. Перенос базы FastCV: облачный Supabase (Франкфурт) → self-hosted Supabase в России.
#
# Запускать на новом сервере из корня репозитория FastCV (нужны supabase/migrations):
#   export SRC_DB_URL='postgresql://postgres.<ref>:<пароль>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
#   bash infra/ru-migration/03-migrate.sh check     # проверки, ничего не меняет
#   bash infra/ru-migration/03-migrate.sh schema    # схема из supabase/migrations в новую базу
#   bash infra/ru-migration/03-migrate.sh data      # данные: public + пользователи (auth.users, auth.identities)
#   bash infra/ru-migration/03-migrate.sh storage   # файлы резюме (нужны URL и service-ключи обеих сторон)
#   bash infra/ru-migration/03-migrate.sh verify    # сверка количества строк и объектов схемы
#
# Источник (SRC_DB_URL) скрипт только читает — старый проект остаётся как был, это и есть откат.
# Новую базу шаг data перезаписывает целиком (TRUNCATE public + пользователи): его можно
# безопасно повторять, например финальной синхронизацией прямо перед переключением.
#
# Утилиты Postgres берутся из контейнера supabase-db (та же версия, что у сервера).
# Для локальных тестов: PG_LOCAL=1 и DST_DB_URL — тогда используются psql/pg_dump с машины.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
WORK="${WORK:-$ROOT/infra/ru-migration/.work}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
PROJECT_DIR="${PROJECT_DIR:-/opt/fastcv-supabase}"
# Внутри контейнера supabase_admin — суперпользователь: нужен для session_replication_role.
# Пароль у всех служебных ролей self-hosted — POSTGRES_PASSWORD из .env проекта
if [ -z "${DST_DB_URL:-}" ]; then
    pass="$(grep '^POSTGRES_PASSWORD=' "$PROJECT_DIR/.env" 2>/dev/null | cut -d= -f2- || true)"
    [ -n "$pass" ] || { echo "❌ Нет POSTGRES_PASSWORD в $PROJECT_DIR/.env — задайте DST_DB_URL" >&2; exit 1; }
    DST_DB_URL="postgresql://supabase_admin:$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$pass")@localhost:5432/postgres"
fi
# Схему применяем от роли postgres, как в облаке: объекты (и security definer-функции)
# должны принадлежать postgres, а не суперпользователю supabase_admin
DST_SCHEMA_URL="${DST_SCHEMA_URL:-${DST_DB_URL/supabase_admin/postgres}}"
mkdir -p "$WORK"
chmod 700 "$WORK"   # в дампе — персональные данные пользователей

die() { echo "❌ $*" >&2; exit 1; }
say() { echo "▶ $*"; }
table() { awk -F'|' '{ printf "   %-38s %12s %12s\n", $1, $2, $3 }'; }  # колонки без util-linux

pg() {  # pg <утилита> <аргументы...> — psql/pg_dump из контейнера или локально
    local tool="$1"; shift
    if [ "${PG_LOCAL:-0}" = "1" ]; then "$tool" "$@"; else docker exec -i "$DB_CONTAINER" "$tool" "$@"; fi
}
src() { [ -n "${SRC_DB_URL:-}" ] || die "Задайте SRC_DB_URL (Supabase → Connect → Session pooler)"; pg psql "$SRC_DB_URL" -v ON_ERROR_STOP=1 -XtAq "$@"; }
dst() { pg psql "$DST_DB_URL" -v ON_ERROR_STOP=1 -XtAq "$@"; }

# Таблицы auth, которые переносим. Сессии и refresh-токены — нет: у нового сервера
# другой JWT-секрет, пользователи просто войдут заново (пароли переносятся — bcrypt-хеши).
AUTH_TABLES=(auth.users auth.identities)

COUNT_SQL="select coalesce(string_agg(format('%s|%s', t, n), E'\n' order by t), '') from (
  select format('%I.%I', schemaname, tablename) t,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint n
  from pg_tables where schemaname = 'public'  -- только таблицы: витрины пересчитываются, их не сверяем
  union all select 'auth.users', (select count(*) from auth.users)
  union all select 'auth.identities', (select count(*) from auth.identities)
) s;"

SCHEMA_SQL="select format('%s|%s', k, n) from (
  select 'tables' k, count(*) n from pg_tables where schemaname = 'public'
  union all select 'functions', count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- без функций расширений
  union all select 'policies', count(*) from pg_policies where schemaname in ('public', 'storage')
  union all select 'triggers', count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
            where not t.tgisinternal and s.nspname in ('public', 'auth')
  union all select 'matviews', count(*) from pg_matviews where schemaname = 'public'
  union all select 'cron_jobs', (select count(*) from cron.job)
) s order by k;"

cmd_check() {
    say "Источник:"; src -c "select current_setting('server_version'), pg_size_pretty(pg_database_size(current_database()))"
    say "Новая база:"; dst -c "select current_setting('server_version')"

    say "Колонки auth: всё, что есть в источнике, должно быть и в новой базе (версия GoTrue)"
    local missing=0
    for t in "${AUTH_TABLES[@]}"; do
        local q="select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='auth' and table_name='${t#auth.}'"
        local a b
        a="$(src -c "$q")"; b="$(dst -c "$q")"
        for col in ${a//,/ }; do
            if [[ ",$b," != *",$col,"* ]]; then echo "   нет колонки $t.$col в новой базе"; missing=1; fi
        done
    done
    [ "$missing" = 0 ] && echo "   ок" || die "Обновите образ supabase/gotrue на новом сервере (sh update.sh) и повторите check"

    say "Расширения, нужные миграциям:"
    dst -c "select string_agg(name, ', ') from pg_available_extensions where name in ('pg_cron','http','pg_trgm','pgcrypto','uuid-ossp')"

    local tables
    tables="$(dst -c "select count(*) from pg_tables where schemaname='public'")"
    echo "   таблиц в public новой базы: $tables (0 — схема ещё не применена, это нормально перед шагом schema)"
    say "Строки в источнике:"; src -c "$COUNT_SQL" | table
}

cmd_schema() {
    local tables
    tables="$(dst -c "select count(*) from pg_tables where schemaname='public'")"
    [ "$tables" = 0 ] || [ "${FORCE:-0}" = 1 ] || die "В public новой базы уже $tables таблиц. Схема применена? Повтор — FORCE=1 (миграции повторяемые)"
    dst -c "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[])"
    for f in "$MIGRATIONS"/*.sql; do
        local base version
        base="$(basename "$f" .sql)"; version="${base%%_*}"
        say "миграция $base"
        pg psql "$DST_SCHEMA_URL" -v ON_ERROR_STOP=1 -Xq --single-transaction < "$f" > /dev/null
        dst -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '${base#*_}') on conflict do nothing"
    done
    # Как в облаке: PostgREST должен увидеть новую схему
    dst -c "notify pgrst, 'reload schema'"
    say "Схема применена: $(ls "$MIGRATIONS"/*.sql | wc -l) миграций"
}

cmd_data() {
    local dump="$WORK/data-$(date +%Y%m%d-%H%M%S).sql"
    local auth=()
    for t in "${AUTH_TABLES[@]}"; do auth+=(--table="$t"); done
    say "Выгрузка данных из источника → $dump"
    # --data-only: только строки (схема уже из миграций); setval для последовательностей — внутри.
    # Два вызова: с --table pg_dump игнорирует --schema, поэтому auth и public — отдельно
    src -c "select 1" > /dev/null
    {
        pg pg_dump "$SRC_DB_URL" --data-only --no-owner --no-privileges "${auth[@]}"
        pg pg_dump "$SRC_DB_URL" --data-only --no-owner --no-privileges --schema=public
    } > "$dump"
    chmod 600 "$dump"
    say "Размер дампа: $(du -h "$dump" | cut -f1)"

    say "Загрузка в новую базу: одной транзакцией, триггеры и проверки ключей на время загрузки выключены"
    # Справочники, которые миграции заполняют сами (skill_aliases, channels…), заменяются данными прода
    local truncate
    truncate="$(dst -c "select string_agg(format('%I.%I', schemaname, tablename), ', ') from pg_tables where schemaname = 'public'")"
    {
        echo "set session_replication_role = replica;"
        echo "truncate $truncate, auth.identities, auth.users cascade;"
        cat "$dump"
        echo "set session_replication_role = origin;"
    } | pg psql "$DST_DB_URL" -v ON_ERROR_STOP=1 -Xq --single-transaction > /dev/null

    say "Пересчёт витрин (материализованные представления)"
    dst -c "select public.refresh_feed_stats()" > /dev/null || echo "   ⚠️ refresh_feed_stats не прошёл — пересчитается кроном через 15 минут"
    dst -c "select public.refresh_employer_slow()" > /dev/null || echo "   ⚠️ refresh_employer_slow не прошёл — пересчитается кроном через час"
    dst -c "analyze"
    say "Данные загружены. Дамп с персональными данными: $dump — удалите после переключения (shred -u)"
}

cmd_storage() {
    for v in SRC_SUPABASE_URL SRC_SERVICE_KEY DST_SUPABASE_URL DST_SERVICE_KEY; do
        [ -n "${!v:-}" ] || die "Задайте $v (URL проекта и service_role/secret-ключ старого и нового Supabase)"
    done
    python3 "$ROOT/infra/ru-migration/copy_storage.py"
}

cmd_verify() {
    local a b
    a="$(src -c "$COUNT_SQL")"; b="$(dst -c "$COUNT_SQL")"
    say "Строки: источник | новая база"
    join -t '|' -a1 -a2 -e '—' -o 0,1.2,2.2 <(sort <<< "$a") <(sort <<< "$b") | table
    local diff_rows
    diff_rows="$(diff <(sort <<< "$a") <(sort <<< "$b") || true)"
    say "Объекты схемы: источник | новая база"
    join -t '|' -o 0,1.2,2.2 <(src -c "$SCHEMA_SQL" | sort) <(dst -c "$SCHEMA_SQL" | sort) | table
    if [ -n "$diff_rows" ]; then
        echo "⚠️ Количество строк расходится (если источник ещё принимает записи — это ожидаемо; повторите data перед переключением)"
        exit 1
    fi
    say "✅ Строки совпадают"
}

case "${1:-}" in
    check) cmd_check ;;
    schema) cmd_schema ;;
    data) cmd_data ;;
    storage) cmd_storage ;;
    verify) cmd_verify ;;
    *) sed -n '2,20p' "$0"; exit 1 ;;
esac
