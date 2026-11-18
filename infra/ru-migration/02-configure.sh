#!/bin/sh
# Шаг 2. Настройки FastCV поверх официального .env self-hosted Supabase.
# Повторяемый: можно запускать сколько угодно раз, меняет только перечисленные ключи.
#
#   RESEND_API_KEY=re_... sh 02-configure.sh
#
# Переменные (необязательно): PROJECT_DIR, DB_DOMAIN, SITE_URL, RESEND_API_KEY.
set -eu

PROJECT_DIR="${PROJECT_DIR:-/opt/fastcv-supabase}"
DB_DOMAIN="${DB_DOMAIN:-db.fastcv.ru}"
SITE_URL="${SITE_URL:-https://fastcv.ru}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"

[ -f "$ENV_FILE" ] || { echo "Нет $ENV_FILE — сначала 01-server-setup.sh" >&2; exit 1; }
cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"   # откат настроек: вернуть этот файл

# set_env KEY VALUE — заменить строку KEY=... или дописать в конец
set_env() {
    key="$1"; value="$2"
    tmp="$ENV_FILE.tmp"
    if grep -q "^${key}=" "$ENV_FILE"; then
        awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" > "$tmp"
        mv "$tmp" "$ENV_FILE"
    else
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
}

# Адреса: API базы — https://db.fastcv.ru (TLS выпускает Caddy), сайт остаётся fastcv.ru
set_env SUPABASE_PUBLIC_URL "https://$DB_DOMAIN"
set_env API_EXTERNAL_URL "https://$DB_DOMAIN/auth/v1"
set_env PROXY_DOMAIN "$DB_DOMAIN"
set_env SITE_URL "$SITE_URL"
# Куда можно возвращать из писем: прод, превью Vercel и локальная разработка
set_env ADDITIONAL_REDIRECT_URLS "$SITE_URL/**,https://*-danila9.vercel.app/**,http://localhost:3000/**"

# Вход — только по email, как в текущем проекте (в базе один провайдер — email)
set_env ENABLE_EMAIL_SIGNUP true
set_env ENABLE_EMAIL_AUTOCONFIRM false
set_env ENABLE_PHONE_SIGNUP false
set_env ENABLE_PHONE_AUTOCONFIRM false
set_env ENABLE_ANONYMOUS_USERS false
set_env DISABLE_SIGNUP false

# Письма авторизации — через Resend, с адреса @fastcv.ru (как письма об откликах)
set_env SMTP_HOST smtp.resend.com
set_env SMTP_PORT 465
set_env SMTP_USER resend
set_env SMTP_ADMIN_EMAIL "noreply@fastcv.ru"
set_env SMTP_SENDER_NAME FastCV
if [ -n "${RESEND_API_KEY:-}" ]; then
    set_env SMTP_PASS "$RESEND_API_KEY"
else
    echo "⚠️  RESEND_API_KEY не задан: письма подтверждения не уйдут. Запустите ещё раз с RESEND_API_KEY=re_..." >&2
fi

# Оверлеи: Caddy (HTTPS) из официального набора + наш docker-compose.fastcv.yml
set_env COMPOSE_FILE "docker-compose.yml:docker-compose.caddy.yml:docker-compose.fastcv.yml"

# Файлы оверлея: наш Caddyfile (+ раздача шаблонов писем), шаблоны писем
cp "$HERE/overlay/docker-compose.fastcv.yml" "$PROJECT_DIR/"
caddyfile="$PROJECT_DIR/volumes/proxy/caddy/Caddyfile"
[ -f "$caddyfile" ] && [ ! -f "$caddyfile.orig" ] && cp "$caddyfile" "$caddyfile.orig"
cp "$HERE/overlay/volumes/proxy/caddy/Caddyfile" "$caddyfile"
mkdir -p "$PROJECT_DIR/volumes/email"
cp "$HERE"/overlay/volumes/email/*.html "$PROJECT_DIR/volumes/email/"

chmod 600 "$ENV_FILE"
echo "Настройки FastCV применены к $ENV_FILE (копия до изменений — рядом, .env.bak.*)."
echo "Применить к запущенному стеку: cd $PROJECT_DIR && sh run.sh recreate"
