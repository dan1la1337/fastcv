"""Копирование файлов Storage (резюме) из облачного Supabase в self-hosted.

Через Storage API, ключами service_role/secret обеих сторон — так не важно, где и как
хранятся файлы (S3, диск). Источник только читается. Повторный запуск безопасен:
файлы загружаются с перезаписью (x-upsert), уже скопированные просто обновятся.

  SRC_SUPABASE_URL=https://<ref>.supabase.co SRC_SERVICE_KEY=... \\
  DST_SUPABASE_URL=https://db.fastcv.ru DST_SERVICE_KEY=... python3 copy_storage.py

Права доступа к резюме — по папке пользователя (storage.foldername), поле owner не нужно.
"""
from __future__ import annotations

import os
import sys
from urllib.parse import quote

import requests

PAGE = 100
TIMEOUT = 60


class Side:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/storage/v1"
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {key}", "apikey": key})

    def get(self, path: str, **kw):
        r = self.session.get(self.base + path, timeout=TIMEOUT, **kw)
        r.raise_for_status()
        return r

    def post(self, path: str, **kw):
        return self.session.post(self.base + path, timeout=TIMEOUT, **kw)


def list_files(side: Side, bucket: str, prefix: str = "") -> list[dict]:
    """Все файлы бакета рекурсивно: у папок в ответе list нет id."""
    files: list[dict] = []
    offset = 0
    while True:
        r = side.post(f"/object/list/{bucket}", json={"prefix": prefix, "limit": PAGE, "offset": offset,
                                                      "sortBy": {"column": "name", "order": "asc"}})
        r.raise_for_status()
        items = r.json()
        for item in items:
            path = f"{prefix}{item['name']}"
            if item.get("id") is None:
                files += list_files(side, bucket, path + "/")
            else:
                files.append({"path": path, "mime": (item.get("metadata") or {}).get("mimetype") or "application/octet-stream"})
        if len(items) < PAGE:
            return files
        offset += PAGE


def ensure_bucket(dst: Side, bucket: dict) -> None:
    """Бакет создают миграции; если его нет — создаём с теми же настройками."""
    body = {k: bucket.get(k) for k in ("id", "name", "public", "file_size_limit", "allowed_mime_types")}
    r = dst.post("/bucket", json=body)
    if r.status_code not in (200, 201, 400, 409):  # 400/409 — уже есть
        r.raise_for_status()


def main() -> int:
    try:
        src = Side(os.environ["SRC_SUPABASE_URL"], os.environ["SRC_SERVICE_KEY"])
        dst = Side(os.environ["DST_SUPABASE_URL"], os.environ["DST_SERVICE_KEY"])
    except KeyError as e:
        print(f"Не задана переменная {e}", file=sys.stderr)
        return 2

    total = failed = 0
    for bucket in src.get("/bucket").json():
        ensure_bucket(dst, bucket)
        files = list_files(src, bucket["id"])
        print(f"Бакет {bucket['id']}: {len(files)} файлов")
        for f in files:
            total += 1
            path = quote(f["path"])
            try:
                data = src.get(f"/object/{bucket['id']}/{path}").content
                r = dst.post(f"/object/{bucket['id']}/{path}", data=data,
                             headers={"Content-Type": f["mime"], "x-upsert": "true"})
                r.raise_for_status()
            except requests.RequestException as e:
                failed += 1
                print(f"  ❌ {f['path']}: {e}", file=sys.stderr)
    print(f"Скопировано {total - failed} из {total}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
