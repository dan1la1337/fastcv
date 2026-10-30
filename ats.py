"""Вакансии из открытых API систем найма (Greenhouse, Workable, Lever), которые компании
публикуют для встраивания списка вакансий на свой сайт.

Берём компании с русскоязычными командами, которых нет в Telegram-каналах и на
карьерных сайтах из careers.py: игровые студии Sperasoft и Tripledot, JetBrains,
Xsolla и Flo Health (у последних — мобильная разработка и fullstack).
Одна должность в нескольких городах — одна вакансия (города через запятую в описании).
Пропала из API — уходит в архив, как вакансии с сайтов компаний (source_post career/...).
Без ИИ: поля переносятся напрямую, направление — по компании или по названию (база).
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Optional

import requests

SOURCE = "career"
USER_AGENT = "Mozilla/5.0 (compatible; FastCVBot/1.0; +https://fastcv.ru)"
RANKING_WEIGHT = 1.0
_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")
# В игровой студии геймдев — те, кто делает игры; продажи, найм, финансы и т. п. — по названию
_NOT_DEV = re.compile(r"account|sales|recruit|talent|\bhr\b|people|financ|payroll|legal|counsel|"
                      r"marketing|office|procurement|business development|\bpr\b|communication|"
                      r"user acquisition|monetization|accountant", re.I)

# Город из API → как в ленте FastCV
CITIES = {
    "yerevan": "Ереван", "belgrade": "Белград", "astana": "Астана", "almaty": "Алматы", "tashkent": "Ташкент",
    "tbilisi": "Тбилиси", "tblisi": "Тбилиси", "minsk": "Минск", "limassol": "Лимассол", "nicosia": "Никосия",
    "paphos": "Пафос", "larnaca": "Ларнака", "warsaw": "Варшава", "krakow": "Краков", "kraków": "Краков",
    "bucharest": "Бухарест", "prague": "Прага", "berlin": "Берлин", "munich": "Мюнхен", "amsterdam": "Амстердам",
    "london": "Лондон", "paris": "Париж", "vilnius": "Вильнюс", "riga": "Рига", "tallinn": "Таллин",
    "istanbul": "Стамбул", "dubai": "Дубай", "lisbon": "Лиссабон", "madrid": "Мадрид", "barcelona": "Барселона",
    "novi sad": "Нови-Сад", "jakarta": "Джакарта", "bishkek": "Бишкек", "baku": "Баку",
    "kyiv": "Киев", "kuala lumpur": "Куала-Лумпур", "bangkok": "Бангкок", "seoul": "Сеул", "beijing": "Пекин",
}


# Страна из строки места в API (бывает только страна: «Estonia - Remote»)
COUNTRIES = {
    "serbia": "Сербия", "armenia": "Армения", "cyprus": "Кипр", "poland": "Польша", "estonia": "Эстония",
    "latvia": "Латвия", "lithuania": "Литва", "georgia": "Грузия", "kazakhstan": "Казахстан", "uzbekistan": "Узбекистан",
    "belarus": "Беларусь", "germany": "Германия", "netherlands": "Нидерланды", "united kingdom": "Великобритания",
    "uk": "Великобритания", "ireland": "Ирландия", "spain": "Испания", "portugal": "Португалия", "france": "Франция",
    "czech republic": "Чехия", "czechia": "Чехия", "romania": "Румыния", "indonesia": "Индонезия",
    "united states": "США", "usa": "США", "china": "Китай", "japan": "Япония", "turkey": "Турция", "türkiye": "Турция",
    "united arab emirates": "ОАЭ", "uae": "ОАЭ", "vietnam": "Вьетнам", "montenegro": "Черногория",
}


@dataclass(frozen=True)
class Board:
    key: str                 # часть source_post: career/<key>/<id>
    name: str                # работодатель на FastCV
    kind: str                # greenhouse | workable | lever
    slug: str                # имя компании в системе найма
    direction: Optional[str] = None   # у игровых студий все роли — геймдев


BOARDS = [
    Board("sperasoft", "Sperasoft", "workable", "sperasoft", "gamedev"),
    Board("tripledot", "Tripledot Studios", "greenhouse", "tripledotstudios", "gamedev"),
    Board("jetbrains", "JetBrains", "greenhouse", "jetbrains"),
    Board("xsolla", "Xsolla", "lever", "xsolla"),
    Board("flo", "Flo Health", "greenhouse", "flohealth"),
]


def clean(value: object, limit: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = _SPACE.sub(" ", html.unescape(_TAG.sub(" ", html.unescape(value)))).strip()
    return text[:limit] or None


def city_of(location: str) -> tuple[Optional[str], bool]:
    """«Belgrade, Serbia», «Estonia - Remote», «Remote Europe» → (город по-русски или None, удалёнка)."""
    low = (location or "").lower()
    remote = "remote" in low
    for part in re.split(r"[;,/|]|\s-\s", low):
        part = part.strip()
        if part in CITIES:
            return CITIES[part], remote
    return None, remote


def country_of(location: str) -> Optional[str]:
    for part in re.split(r"[;,/|]|\s-\s", (location or "").lower()):
        if part.strip() in COUNTRIES:
            return COUNTRIES[part.strip()]
    return None


def fetch_jobs(board: Board, get: Callable[[str], dict]) -> list[dict]:
    """[{id, title, url, location, description, posted_at}] из API системы найма."""
    jobs = []
    if board.kind == "greenhouse":
        data = get(f"https://boards-api.greenhouse.io/v1/boards/{board.slug}/jobs?content=true")
        for j in data.get("jobs") or []:
            jobs.append({"id": str(j.get("id")), "title": j.get("title"), "url": j.get("absolute_url"),
                         "location": (j.get("location") or {}).get("name") or "",
                         "description": j.get("content"), "posted_at": j.get("first_published") or j.get("updated_at")})
    elif board.kind == "workable":
        data = get(f"https://apply.workable.com/api/v1/widget/accounts/{board.slug}?details=true")
        for j in data.get("jobs") or []:
            location = ", ".join(filter(None, [j.get("city"), j.get("country")]))
            if j.get("telecommuting"):
                location += " - Remote"
            jobs.append({"id": j.get("shortcode"), "title": j.get("title"), "url": j.get("url") or j.get("shortlink"),
                         "location": location, "description": j.get("description"),
                         "posted_at": j.get("published_on") or j.get("created_at")})
    elif board.kind == "lever":
        data = get(f"https://api.lever.co/v0/postings/{board.slug}?mode=json")
        for j in data if isinstance(data, list) else []:
            cats = j.get("categories") or {}
            location = "; ".join(cats.get("allLocations") or []) or cats.get("location") or ""
            if j.get("workplaceType") == "remote" and "remote" not in location.lower():
                location += " - Remote"
            created = j.get("createdAt")
            jobs.append({"id": j.get("id"), "title": j.get("text"), "url": j.get("hostedUrl"),
                         "location": location, "description": j.get("descriptionPlain") or j.get("description"),
                         "posted_at": datetime.fromtimestamp(created / 1000, timezone.utc).isoformat()
                         if isinstance(created, (int, float)) else None})
    return [j for j in jobs if j["id"] and j["title"] and j["url"]]


def rows_for(board: Board, jobs: list[dict]) -> list[dict]:
    """Одна строка на должность: та же должность в разных городах — одна вакансия."""
    by_title: dict[str, list[dict]] = {}
    for j in jobs:
        by_title.setdefault(_SPACE.sub(" ", j["title"].lower()).strip(), []).append(j)
    rows = []
    for group in by_title.values():
        first = min(group, key=lambda j: j["id"])
        places = [city_of(j["location"]) for j in group]
        cities = list(dict.fromkeys(c for c, _ in places if c))
        remote = any(r for _, r in places)
        where = ", ".join(cities[:6]) + (" и др." if len(cities) > 6 else "")
        description = clean(first.get("description"), 650)
        if len(cities) > 1:
            description = f"Города: {where}. {description or ''}".strip()
        row = {
            "source_post": f"{SOURCE}/{board.key}/{first['id']}",
            "source_url": first["url"],
            "source_type": "external",
            "title": clean(first["title"], 200),
            "company_name": board.name,
            "description": description[:700] if description else None,
            "city": cities[0] if cities else None,
            "is_remote": remote,
            "work_format": "remote" if remote and not cities else None,
            # Страну по городу определит база; это — для вакансий, где указана только страна
            "country": next((c for c in (country_of(j["location"]) for j in group) if c), None),
            "posted_at": first.get("posted_at") or datetime.now(timezone.utc).isoformat(),
            "ranking_weight": RANKING_WEIGHT,
        }
        # Ключ есть у всех строк: в пакетной записи столбцы берутся одни на все строки;
        # None — направление определит база по названию
        row["direction"] = board.direction if board.direction and not _NOT_DEV.search(row["title"] or "") else None
        rows.append(row)
    return rows


def make_get(session: Optional[requests.Session] = None) -> Callable[[str], dict]:
    session = session or requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})

    def get(url: str) -> dict:
        r = session.get(url, timeout=30)
        r.raise_for_status()
        return r.json()
    return get


def import_boards(store, get: Callable[[str], dict], boards: list[Board] = BOARDS) -> dict:
    stats: dict[str, dict] = {}
    for board in boards:
        info = stats.setdefault(board.key, {})
        try:
            rows = rows_for(board, fetch_jobs(board, get))
        except (requests.RequestException, ValueError) as e:
            info["error"] = type(e).__name__
            continue
        live = {r["source_post"].rsplit("/", 1)[1] for r in rows}
        known = store.career_ids(board.key)
        active = [vid for vid, archived in known.items() if not archived]
        gone = [vid for vid in active if vid not in live]
        # Пустой или урезанный ответ API — скорее сбой, чем закрытие половины вакансий разом
        if rows and len(gone) <= max(len(active) // 2, 5):
            info["archived"] = store.archive_career(board.key, gone) if gone else 0
        if rows:
            # Вернувшаяся вакансия снова в ленте
            store.upsert_imported([{**r, "archived_at": None} for r in rows])
        info.update(live=len(rows), new=sum(1 for vid in live if vid not in known))
    return stats


def run(store) -> dict:
    return import_boards(store, make_get())
