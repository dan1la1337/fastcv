#!/bin/sh
# Шаг 1. Поднять self-hosted Supabase на сервере в России (Timeweb Cloud, Selectel и т.п.).
#
# Запускать на самом сервере (Ubuntu 22.04/24.04), от root или через sudo:
#   sh 01-server-setup.sh
#
# Что делает:
#   1. Ставит Docker и зависимости и разворачивает официальный docker-compose Supabase
#      (supabase/supabase, папка docker) зафиксированной версии — SUPABASE_REF ниже.
#   2. Генерирует все секреты и ключи (официальные utils/*.sh).
#   3. Накладывает настройки FastCV (02-configure.sh) и наш оверлей:
#      Caddy с HTTPS для db.fastcv.ru, русские письма авторизации.
#
# Старый проект Supabase (Франкфурт) этот скрипт не трогает.
set -eu

SUPABASE_REF="${SUPABASE_REF:-self-hosted/v0.8.4}"   # проверено 05.11.2026
PROJECT_DIR="${PROJECT_DIR:-/opt/fastcv-supabase}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ -d "$PROJECT_DIR" ] && [ -f "$PROJECT_DIR/.env" ]; then
    echo "Проект уже есть в $PROJECT_DIR — повторно не разворачиваю. Для настройки: sh $HERE/02-configure.sh" >&2
    exit 1
fi

mkdir -p "$(dirname "$PROJECT_DIR")"
cd "$(dirname "$PROJECT_DIR")"
curl -fsSL "https://raw.githubusercontent.com/supabase/supabase/${SUPABASE_REF}/docker/setup.sh" -o /tmp/supabase-setup.sh
# -y: без вопросов; URL-ы и всё остальное выставит 02-configure.sh
sh /tmp/supabase-setup.sh -y --ref "$SUPABASE_REF" --project-dir "$(basename "$PROJECT_DIR")"

PROJECT_DIR="$PROJECT_DIR" sh "$HERE/02-configure.sh"

echo
echo "Готово. Дальше:"
echo "  1. DNS: A-запись db.fastcv.ru → IP этого сервера (Caddy сам выпустит сертификат)."
echo "  2. Запуск: cd $PROJECT_DIR && sh run.sh start"
echo "  3. Перенос данных: sh $HERE/03-migrate.sh check"
