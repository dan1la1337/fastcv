"""Вакансии «Хабр Карьеры» из её открытой RSS-ленты: менеджеры продукта и проектов, продуктовые аналитики.

RSS-лента (career.habr.com/vacancies/rss) открыта в robots.txt и отдаёт по 50 вакансий на
страницу с фильтром по специализации. Страницы вакансий не читаем: в ленте уже есть
название, компания, города, зарплата, формат работы и навыки. На FastCV — эта выжимка и
ссылка на вакансию на «Хабр Карьере». Пропала из ленты — уходит в архив, как вакансии
с сайтов компаний (source_post career/habr/<id>). Без ИИ: направление — по специализации
и названию (roles.py).
"""

from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable, Optional

import requests

import careers
from careers import RANKING_WEIGHT, SOURCE, Blocked
from roles import is_pm_title

KEY = "habr"
COMPANY = "Хабр Карьера"
RSS = "https://career.habr.com/vacancies/rss"
PAUSE = 1.5
MAX_PAGES = 20
# Специализации «Хабр Карьеры» → направление FastCV. В специализации компании ставят и чужие
# роли («Технический специалист», «Менеджер по успеху клиентов», «Менеджер проекта (отделка)»):
# берём только вакансии, у которых роль видна по названию
FEEDS = [
    # Project Manager, Project Director, Product Manager, Delivery Manager, Scrum Master,
    # Product Owner, Program Manager
    ((32, 33, 34, 185, 119, 210, 37), "product", is_pm_title),
    # Продуктовый аналитик
    ((97,), "analytics", lambda title: bool(re.search(r"аналитик|analyst", title or "", re.I))),
]
_TITLE = re.compile(r"^Требуется\s+«(.+)»(?:\s+\([^()]*\))?\s*$", re.S)
_INTRO = re.compile(r"^Компания\s+«.*?»\s+ищет хорошего специалиста на вакансию\s+«.*?»\.\s*", re.S)
_PLACE = re.compile(r"([^,.()]+?)\s+\(([^()]+)\)")
_SALARY = re.compile(r"(?:От\s+([\d\s]+)\s*([₽$€₸]))?\s*(?:до\s+([\d\s]+)\s*([₽$€₸]))?\.", re.I)
_CURRENCY = {"₽": "RUB", "$": "USD", "€": "EUR", "₸": "KZT"}


def _num(value: Optional[str]) -> Optional[int]:
    digits = re.sub(r"\D", "", value or "")
    return int(digits) if digits else None


def parse_salary(text: str) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """«От 160 000 ₽ до 180 000 ₽.», «До 500 000 ₽.», «От 4 500 $.» → (от, до, валюта)."""
    for m in _SALARY.finditer(text):
        if m.group(1) or m.group(3):
            currency = _CURRENCY.get(m.group(2) or m.group(4))
            return _num(m.group(1)), _num(m.group(3)), currency
    return None, None, None


def parse_places(text: str) -> tuple[list[str], list[str]]:
    """Начало описания «Москва (Россия), Белград (Сербия). …» → (города, страны)."""
    head = text.split(".", 1)[0]
    if "(" not in head:
        return [], []
    places = _PLACE.findall(head)
    return [c.strip() for c, _ in places], [k.strip() for _, k in places]


def row_from_item(item: ET.Element, direction: Optional[str]) -> Optional[dict]:
    vid = (item.findtext("guid") or "").strip()
    url = (item.findtext("link") or "").strip()
    m = _TITLE.match(html.unescape(item.findtext("title") or "").strip())
    if not (vid.isdigit() and url.startswith("https://career.habr.com/") and m):
        return None
    text = html.unescape(item.findtext("description") or "").strip()
    details = _INTRO.sub("", text)
    cities, countries = parse_places(details)
    low, high, currency = parse_salary(details)
    remote = "Можно удалённо" in details
    try:
        posted = parsedate_to_datetime(item.findtext("pubDate") or "").isoformat()
    except (TypeError, ValueError):
        posted = datetime.now(timezone.utc).isoformat()
    return {
        "source_post": f"{SOURCE}/{KEY}/{vid}",
        "source_url": url,
        "source_type": "external",
        "title": careers.clean(m.group(1), 200),
        "company_name": careers.clean(item.findtext("author"), 200) or COMPANY,
        "description": careers.clean(details, 700),
        "salary_min": low, "salary_max": high, "salary_currency": currency,
        "city": cities[0] if cities else None,
        # Страну по городу определит база; это — когда город не из её списка
        "country": countries[0] if countries else None,
        "is_remote": remote,
        "work_format": "remote" if remote and not cities else None,
        "posted_at": posted,
        "ranking_weight": RANKING_WEIGHT,
        "direction": direction,
    }


def feed_url(specs: tuple[int, ...], page: int) -> str:
    return RSS + "?" + "&".join(f"s[]={s}" for s in specs) + f"&type=all&page={page}"


def fetch_rows(get: Callable[[str], Optional[str]]) -> Optional[list[dict]]:
    """Все вакансии лент; None — если какую-то страницу прочитать не удалось (не архивируем)."""
    rows: dict[str, dict] = {}
    for specs, direction, wanted in FEEDS:
        for page in range(1, MAX_PAGES + 1):
            body = get(feed_url(specs, page))
            if body is None:
                return None
            try:
                items = ET.fromstring(body).findall("./channel/item")
            except ET.ParseError:
                return None
            for item in items:
                row = row_from_item(item, direction)
                if row and wanted(row["title"]):
                    # Вакансия в двух лентах — направление по первой (продукт важнее аналитики)
                    rows.setdefault(row["source_post"], row)
            if not items:
                break
    return list(rows.values())


def import_habr(store, get: Callable[[str], Optional[str]]) -> dict:
    try:
        rows = fetch_rows(get)
    except (requests.RequestException, Blocked) as e:
        return {"error": type(e).__name__}
    if rows is None:
        return {"error": "feed"}
    live = {r["source_post"].rsplit("/", 1)[1] for r in rows}
    known = store.career_ids(KEY)
    active = [vid for vid, archived in known.items() if not archived]
    gone = [vid for vid in active if vid not in live]
    info: dict = {}
    # Пустая или урезанная лента — скорее сбой, чем закрытие половины вакансий разом
    if rows and len(gone) <= max(len(active) // 2, 5):
        info["archived"] = store.archive_career(KEY, gone) if gone else 0
    if rows:
        store.upsert_imported([{**r, "archived_at": None} for r in rows])
    info.update(live=len(rows), new=sum(1 for vid in live if vid not in known))
    return info


def run(store, fetcher: Optional[careers.Fetcher] = None) -> dict:
    fetcher = fetcher or careers.Fetcher()
    return import_habr(store, lambda url: fetcher.get(url, PAUSE))
