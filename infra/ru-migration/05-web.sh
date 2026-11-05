#!/bin/sh
# Этап 2 (необязательный): сайт fastcv.ru на этом же сервере вместо Vercel.
# Тогда за рубеж не уходит ничего, кроме обезличенного текста в Gemini и писем через Resend.
#
#   sudo GEMINI_API_KEY=... TELEGRAM_JOBS_BOT_TOKEN=... sh infra/ru-migration/05-web.sh
#
# Делает: прописывает настройки сайта в .env Supabase, подключает docker-compose.web.yml и
# сайт в Caddy. Запуск и переключение DNS — вручную (команды в конце), чтобы выбрать момент.
# Откат: sh 05-web.sh off — и вернуть DNS fastcv.ru на Vercel (сайт там продолжает работать).
set -eu

PROJECT_DIR="${PROJECT_DIR:-/opt/fastcv-supabase}"
WEB_DOMAIN="${WEB_DOMAIN:-fastcv.ru}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
SITES="$PROJECT_DIR/volumes/proxy/caddy/sites"

[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — сначала 01-server-setup.sh" >&2; exit 1; }
cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"

set_env() {
    key="$1"; value="$2"; tmp="$ENV_FILE.tmp"
    if grep -q "^${key}=" "$ENV_FILE"; then
        awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" > "$tmp" && mv "$tmp" "$ENV_FILE"
    else
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
}
compose="$(grep '^COMPOSE_FILE=' "$ENV_FILE" | cut -d= -f2-)"

if [ "${1:-}" = "off" ]; then
    set_env COMPOSE_FILE "$(echo "$compose" | sed 's/:docker-compose.web.yml//')"
    rm -f "$SITES/web.caddy"
    echo "Сайт отключён в конфигурации. Применить: cd $PROJECT_DIR && sh run.sh recreate caddy && docker rm -f fastcv-web"
    echo "Не забудьте вернуть DNS fastcv.ru на Vercel."
    exit 0
fi

cp "$HERE/overlay/docker-compose.web.yml" "$PROJECT_DIR/"
case ":$compose:" in *":docker-compose.web.yml:"*) ;; *) set_env COMPOSE_FILE "$compose:docker-compose.web.yml" ;; esac
set_env FASTCV_REPO "$REPO"
set_env WEB_DOMAIN "$WEB_DOMAIN"
[ -n "${GEMINI_API_KEY:-}" ] && set_env GEMINI_API_KEY "$GEMINI_API_KEY"
[ -n "${TELEGRAM_JOBS_BOT_TOKEN:-}" ] && set_env TELEGRAM_JOBS_BOT_TOKEN "$TELEGRAM_JOBS_BOT_TOKEN"
grep -q '^GEMINI_API_KEY=.' "$ENV_FILE" || echo "⚠️  GEMINI_API_KEY не задан: ИИ-функции сайта будут отвечать «ИИ не настроен»" >&2

mkdir -p "$SITES"
cp "$HERE/overlay/volumes/proxy/caddy/sites-available/web.caddy" "$SITES/"
cp "$HERE/overlay/volumes/proxy/caddy/Caddyfile" "$PROJECT_DIR/volumes/proxy/caddy/Caddyfile"
chmod 600 "$ENV_FILE"

cat <<MSG
Готово. Дальше:
  1. Собрать и запустить сайт (5–10 минут):  cd $PROJECT_DIR && docker compose build web && sh run.sh recreate
  2. Проверить до переключения DNS:            curl -sk --resolve $WEB_DOMAIN:443:127.0.0.1 https://$WEB_DOMAIN/ | head -c 300
  3. DNS: A-записи $WEB_DOMAIN и www.$WEB_DOMAIN → IP этого сервера (сертификат Caddy выпустит сам)
  4. Telegram-бот: https://$WEB_DOMAIN/admin → «Подключить бота подборок» — webhook переедет на сервер
Обновление сайта после изменений в main:  cd $REPO && git pull && cd $PROJECT_DIR && docker compose build web && sh run.sh recreate web
MSG
