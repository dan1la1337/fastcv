#!/bin/sh
# Шаг 4. Ежедневные резервные копии базы на новом сервере.
#
#   sh 04-backup.sh             # сделать копию сейчас
#   sh 04-backup.sh install     # ставит в cron: каждый день в 04:20, хранить 14 дней
#
# Копия — pg_dump в формате custom (-Fc) из контейнера supabase-db, в BACKUP_DIR.
# Восстановление всей базы из копии:
#   docker exec -i -e PGPASSWORD=<POSTGRES_PASSWORD> supabase-db pg_restore -h localhost -U supabase_admin -d postgres --clean --if-exists < файл.dump
# Копии содержат персональные данные: держите их только в России (этот сервер или
# объектное хранилище российского провайдера), права — только root.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/fastcv}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
PROJECT_DIR="${PROJECT_DIR:-/opt/fastcv-supabase}"

if [ "${1:-}" = "install" ]; then
    script="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
    line="20 4 * * * BACKUP_DIR=$BACKUP_DIR KEEP_DAYS=$KEEP_DAYS sh $script >> /var/log/fastcv-backup.log 2>&1"
    ( crontab -l 2>/dev/null | grep -v "$script" ; echo "$line" ) | crontab -
    echo "Добавлено в cron: $line"
    exit 0
fi

umask 077
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/fastcv-$(date +%Y%m%d-%H%M%S).dump"
# Схемы приложения и пользователи; служебные схемы Supabase образ создаёт сам
pass="$(grep '^POSTGRES_PASSWORD=' "$PROJECT_DIR/.env" | cut -d= -f2-)"
docker exec -e PGPASSWORD="$pass" "$DB_CONTAINER" pg_dump -h localhost -U supabase_admin -d postgres -Fc \
    --schema=public --schema=auth --schema=storage --schema=supabase_migrations > "$file.part"
mv "$file.part" "$file"
echo "$(date '+%F %T') копия $file ($(du -h "$file" | cut -f1))"
find "$BACKUP_DIR" -name 'fastcv-*.dump' -mtime +"$KEEP_DAYS" -delete
