"""Импорт вакансий SuperJob через официальный API (api.superjob.ru, ключ приложения —
секрет SUPERJOB_API_KEY). Как и «Работа России», без ИИ: поля переносятся напрямую,
направление — по каталогу SuperJob или по названию (триггер базы).

SuperJob публикует ~60 тыс. вакансий в сутки, а бесплатный тариф базы мал, поэтому храним
окно последних KEEP_HOURS часов и потолок MAX_STORED; prune_imported() убирает старое.
Закрытые и архивные вакансии пропускаем (skipped).
API отдаёт не больше 500 результатов на запрос, поэтому идём окнами по времени публикации
и дробим окно, пока в нём не станет ≤ 500 вакансий.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

import requests

from trudvsem import level_for, money, sphere_direction, text

API = "https://api.superjob.ru/2.0/vacancies/"
SOURCE = "superjob"
PAGE = 100                      # API отдаёт не больше 40 на страницу — идём по признаку more
API_LIMIT = 500                 # больше API не отдаёт ни на какой запрос
KEEP_HOURS = 8
MAX_STORED = 20_000
WINDOW = timedelta(hours=1)
MIN_WINDOW = timedelta(minutes=1)
CURSOR_KEY = "superjob_cursor"  # время, с которого продолжать
TIME_BUDGET_SECONDS = 6 * 60
REQUEST_PAUSE = 0.55            # лимит API — 120 запросов в минуту
RANKING_WEIGHT = 0.95           # ниже Telegram и прямых работодателей, выше «Работы России»
# Опыт в SuperJob: 1 — без опыта, 2 — от 1 года, 3 — от 3 лет, 4 — от 6 лет
_EXPERIENCE = {1: 0.0, 2: 1.0, 3: 3.0, 4: 6.0}
_CURRENCY = {"rub": "RUB", "uah": "UAH", "uzs": "UZS", "kzt": "KZT", "byn": "BYN", "usd": "USD", "eur": "EUR"}


def map_vacancy(v: dict) -> Optional[dict]:
    vid, title = v.get("id"), text(v.get("profession"), 200)
    if not vid or not title or v.get("is_archive") or v.get("is_closed"):
        return None
    salary_min, salary_max = money(v.get("payment_from")), money(v.get("payment_to"))
    currency = _CURRENCY.get(str(v.get("currency") or "").lower()) if (salary_min or salary_max) else None
    if (salary_min or salary_max) and not currency:
        salary_min = salary_max = None
    years = _EXPERIENCE.get((v.get("experience") or {}).get("id"))
    kinds = f"{(v.get('place_of_work') or {}).get('title') or ''} {(v.get('type_of_work') or {}).get('title') or ''}".lower()
    remote = "удал" in kinds or "на дому" in kinds
    catalogues = v.get("catalogues") or []
    published = v.get("date_published")
    return {
        "source_post": f"{SOURCE}/{vid}",
        "source_url": v.get("link"),
        "source_type": "external",
        "title": title,
        "company_name": None if v.get("anonymous") else text(v.get("firm_name"), 200),
        "description": text(v.get("candidat") or v.get("vacancyRichText"), 700),
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_currency": currency,
        "city": text((v.get("town") or {}).get("title"), 100),
        "direction": sphere_direction(catalogues[0].get("title") or "") if catalogues else None,
        "is_remote": remote,
        "work_format": "remote" if remote else None,
        "experience_min": years,
        "level": level_for(years),
        "posted_at": datetime.fromtimestamp(published, timezone.utc).isoformat() if isinstance(published, (int, float)) else None,
        "ranking_weight": RANKING_WEIGHT,
    }


def make_fetch(api_key: str) -> Callable[[dict], dict]:
    session = requests.Session()
    session.headers.update({"X-Api-App-Id": api_key, "User-Agent": "FastCV/1.0 (+https://fastcv.ru)"})

    def fetch(params: dict) -> dict:
        time.sleep(REQUEST_PAUSE)
        response = session.get(API, params=params, timeout=30)
        response.raise_for_status()
        return response.json()

    return fetch


def _params(start: datetime, end: datetime, page: int) -> dict:
    return {"date_published_from": int(start.timestamp()), "date_published_to": int(end.timestamp()) - 1,
            "count": PAGE, "page": page, "order_field": "date", "order_direction": "asc"}


def import_superjob(store, fetch: Callable[[dict], dict], now: Optional[datetime] = None,
                    clock: Callable[[], float] = time.monotonic, time_budget: float = TIME_BUDGET_SECONDS) -> dict:
    now = now or datetime.now(timezone.utc)
    pruned = store.prune_source(SOURCE, KEEP_HOURS) or {}
    stored = store.count_source(SOURCE)
    oldest = now - timedelta(hours=KEEP_HOURS)
    saved_cursor = store.get_setting(CURSOR_KEY)
    start = max(datetime.fromisoformat(saved_cursor) - timedelta(minutes=10), oldest) if saved_cursor else oldest
    started_clock = clock()
    seen = saved = skipped = 0
    stop_reason = None
    window = WINDOW
    while start < now:
        if stored + saved >= MAX_STORED:
            stop_reason = "storage cap"
            break
        if clock() - started_clock > time_budget:
            stop_reason = "time budget"
            break
        end = min(start + window, now)
        first = fetch(_params(start, end, 0))
        total = int(first.get("total") or 0)
        if total > API_LIMIT and end - start > MIN_WINDOW:
            window = max((end - start) / 2, MIN_WINDOW)     # окно слишком широкое — дробим
            continue
        pages, page, data = [], 0, first
        while True:
            items = data.get("objects") or []
            pages.extend(items)
            page += 1
            if not data.get("more") or len(pages) >= API_LIMIT or not items:
                break
            data = fetch(_params(start, end, page))
        seen += len(pages)
        # Поле trud_vsem заполнено у всех вакансий SuperJob — дубли по нему не отсеять
        rows = [row for row in (map_vacancy(v) for v in pages) if row]
        skipped += len(pages) - len(rows)
        if rows:
            saved += store.upsert_imported(rows)
        start = end
        store.set_setting(CURSOR_KEY, start.isoformat())
        if total * 2 < API_LIMIT:
            window = min(window * 2, WINDOW)                # в окне мало вакансий — расширяем
    return {"seen": seen, "saved": saved, "skipped": skipped, "stopped": stop_reason, **pruned}


def run(store, api_key: str) -> dict:
    return import_superjob(store, make_fetch(api_key))


if __name__ == "__main__":  # ручная проверка: python superjob.py <ключ> — печатает первую страницу
    import sys
    sample = make_fetch(sys.argv[1])({"count": 3})
    print(json.dumps([map_vacancy(v) for v in sample.get("objects") or []], ensure_ascii=False, indent=1))
