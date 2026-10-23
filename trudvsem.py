"""Импорт вакансий из «Работы России» (opendata.trudvsem.ru) — государственной базы
с открытым API. Данные уже разложены по полям, поэтому ИИ не нужен: только перенос
полей и нормализация в базе (город, направление, уровень — триггер vacancies_normalize).

На бесплатном тарифе базы держим окно последних двух суток: каждый запуск берёт
вакансии, изменённые с прошлого раза, а prune_trudvsem() убирает устаревшие.
"""

from __future__ import annotations

import html
import time
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

import requests

API = "https://opendata.trudvsem.ru/api/v1/vacancies"
PAGE = 100
SYNC_KEY = "trudvsem_synced_at"
CURSOR_KEY = "trudvsem_cursor"      # незаконченный обход: {"since", "started", "region"}
KEEP_DAYS = 2
MAX_PER_RUN = 15_000      # ~150 запросов, несколько минут
MAX_STORED = 50_000       # потолок для бесплатного тарифа базы (~240 МБ)
RANKING_WEIGHT = 0.9
MAX_PAGES_PER_REGION = 30
TIME_BUDGET_SECONDS = 10 * 60   # дальше обход продолжит следующий запуск
# Коды регионов в API: две цифры региона и одиннадцать нулей (7700000000000 — Москва)
REGION_CODES = [f"{n:02d}00000000000" for n in range(1, 100)]
# Сфера вакансии в «Работе России» → направление FastCV. ИТ-сферу не сопоставляем:
# направление определит база по названию («Программист» → backend). Остальное — по
# сфере, иначе «Полицейский мобильного взвода» попадал в Mobile, а охранник — в ИБ.
_SPHERES = [("информационные технологии", None), ("информационная безопасность", "security"), ("маркетинг", "marketing"), ("реклам", "marketing"),
            ("продаж", "sales"), ("бухгалтер", "finance"), ("финанс", "finance"), ("банк", "finance"),
            ("страхован", "finance"), ("образовани", "education"), ("наук", "education"),
            ("персонал", "hr"), ("кадр", "hr"), ("сми", "content"), ("издатель", "content"),
            ("искусств", "content"), ("культур", "content"), ("юрист", "legal"), ("юриспруд", "legal"),
            ("здравоохран", "medicine"), ("медицин", "medicine"), ("фармац", "medicine"),
            ("транспорт", "logistics"), ("логист", "logistics"), ("строительств", "construction"),
            ("недвижим", "construction"), ("производств", "production"), ("промышлен", "production"),
            ("добыва", "production"), ("жкх", "production"), ("сельск", "production"),
            ("не требующ", "production"), ("туризм", "hospitality"), ("гостиниц", "hospitality"),
            ("ресторан", "hospitality"), ("государствен", "government"), ("безопасност", "government"),
            ("силов", "government"), ("административ", "office"), ("секретар", "office"),
            ("высший менеджмент", "management")]

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")
_CITY = re.compile(r"(?:^|[\s,])г\.?\s*([А-ЯЁ][А-Яа-яЁё-]+(?:\s[А-ЯЁ][а-яё-]+)?)")
_FEDERAL_CITIES = {"г. Москва": "Москва", "Москва": "Москва", "г. Санкт-Петербург": "Санкт-Петербург",
                   "Санкт-Петербург": "Санкт-Петербург", "г. Севастополь": "Севастополь", "Севастополь": "Севастополь"}


def text(value: object, limit: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = _SPACE.sub(" ", html.unescape(_TAG.sub(" ", value))).strip()
    return cleaned[:limit] or None


def city_of(v: dict) -> Optional[str]:
    region = ((v.get("region") or {}).get("name") or "").strip()
    if region in _FEDERAL_CITIES:
        return _FEDERAL_CITIES[region]
    for address in (v.get("addresses") or {}).get("address") or []:
        match = _CITY.search(address.get("location") or "")
        if match:
            return match.group(1)
    return None


def money(value: object) -> Optional[int]:
    return int(value) if isinstance(value, (int, float)) and 0 < value < 100_000_000 else None


def level_for(years: Optional[float]) -> Optional[str]:
    """Шкала FastCV; без опыта уровень не ставим — его определит база по названию."""
    if years is None or years < 1:
        return None
    return "junior" if years < 2 else "middle" if years < 5 else "senior"


def direction_of(v: dict) -> Optional[str]:
    sphere = ((v.get("category") or {}).get("specialisation") or "").lower()
    if not sphere:
        return None
    for key, direction in _SPHERES:
        if key in sphere:
            return direction
    return None     # сфера без пары — направление определит база по названию


def map_vacancy(v: dict) -> Optional[dict]:
    """Вакансия «Работы России» → строка vacancies. None — если не хватает главного."""
    vid, title = v.get("id"), text(v.get("job-name"), 200)
    if not vid or not title:
        return None
    company = v.get("company") or {}
    salary_min, salary_max = money(v.get("salary_min")), money(v.get("salary_max"))
    if salary_min and salary_max == salary_min and str(v.get("salary", "")).startswith("от"):
        salary_max = None
    experience = (v.get("requirement") or {}).get("experience")
    years = float(experience) if isinstance(experience, (int, float)) and 0 <= experience <= 30 else None
    schedule = f"{v.get('schedule') or ''} {v.get('employment') or ''}".lower()
    remote = "удал" in schedule or "дистанц" in schedule
    email = next((c.get("contact_value") for c in v.get("contact_list") or []
                  if "почт" in (c.get("contact_type") or "").lower() and c.get("contact_value")), None)
    description = " ".join(filter(None, [text(v.get("duty"), 450), text(v.get("requirements"), 300)]))
    return {
        "source_post": f"trudvsem/{vid}",
        "source_url": v.get("vac_url"),
        "source_type": "external",
        "title": title,
        "company_name": text(company.get("name"), 200),
        "description": description[:700] or None,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_currency": "RUB" if (salary_min or salary_max) else None,
        "city": city_of(v),
        "direction": direction_of(v),
        "is_remote": remote,
        "work_format": "remote" if remote else None,
        "experience_min": years,
        "level": level_for(years),
        "hiring_type": "agency" if company.get("hr-agency") else None,
        "contact_type": "email" if email else None,
        "contact_value": (email or "").strip()[:200] or None,
        "posted_at": v.get("date_modify") or v.get("creation-date"),
        "ranking_weight": RANKING_WEIGHT,
    }


def fetch_json(url: str, params: dict) -> dict:
    response = requests.get(url, params=params, timeout=40, headers={"User-Agent": "FastCV/1.0 (+https://fastcv.ru)"})
    response.raise_for_status()
    return response.json()


def import_trudvsem(store, fetch: Callable[[str, dict], dict] = fetch_json, now: Optional[datetime] = None,
                    max_rows: int = MAX_PER_RUN, clock: Callable[[], float] = time.monotonic,
                    time_budget: float = TIME_BUDGET_SECONDS) -> dict:
    """Новые и изменённые с прошлого запуска вакансии → vacancies. Возвращает статистику."""
    now = now or datetime.now(timezone.utc)
    stored = store.count_trudvsem()
    if stored >= MAX_STORED:
        return {"skipped": f"в базе уже {stored} вакансий «Работы России» — потолок бесплатного тарифа"}

    # Обход регионов может не уложиться в один запуск (лимит строк): тогда следующий
    # запуск продолжает с того же региона и с той же точки отсчёта
    cursor = json.loads(store.get_setting(CURSOR_KEY) or "null") or {}
    if cursor:
        since, started, start = datetime.fromisoformat(cursor["since"]), cursor["started"], int(cursor["region"])
    else:
        synced = store.get_setting(SYNC_KEY)
        since = (datetime.fromisoformat(synced) - timedelta(hours=1)) if synced else now - timedelta(days=KEEP_DAYS)
        started, start = now.isoformat(), 0
    params = {"modifiedFrom": since.strftime("%Y-%m-%dT%H:%M:%SZ"), "limit": PAGE}
    saved = seen = failed = 0
    budget = min(max_rows, MAX_STORED - stored)
    stopped_at = None
    started_clock = clock()
    # API не отдаёт глубокие страницы (offset — номер страницы, на сотнях — ошибка 500),
    # поэтому идём по регионам: в каждом за несколько часов изменений немного
    for index in range(start, len(REGION_CODES)):
        if seen >= budget or clock() - started_clock > time_budget:
            stopped_at = index
            break
        for page in range(MAX_PAGES_PER_REGION):
            try:
                data = fetch(f"{API}/region/{REGION_CODES[index]}", {**params, "offset": page})
            except (requests.RequestException, ValueError):
                failed += 1
                break
            items = ((data.get("results") or {}).get("vacancies") or [])
            rows = [row for row in (map_vacancy(i.get("vacancy") or {}) for i in items) if row]
            if rows:
                saved += store.upsert_trudvsem(rows)
            seen += len(items)
            if len(items) < PAGE:
                break
            if seen >= budget:
                stopped_at = index      # регион мог остаться недочитанным — повторим его
                break
        if stopped_at is not None:
            break
    if stopped_at is None:
        store.set_setting(SYNC_KEY, started)
        store.set_setting(CURSOR_KEY, "")
    else:
        store.set_setting(CURSOR_KEY, json.dumps({"since": since.isoformat(), "started": started, "region": stopped_at}))
    pruned = store.prune_trudvsem(KEEP_DAYS)
    return {"seen": seen, "saved": saved, "failed_regions": failed,
            "resume_region": stopped_at, **(pruned or {})}
