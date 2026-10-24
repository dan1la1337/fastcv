"""Вакансии с карьерных сайтов крупных работодателей (Т-Банк, МТС, VK, Avito, Альфа-Банк…).

Источник — карта сайта (sitemap.xml), которую компании публикуют для поисковых роботов:
в ней перечислены страницы вакансий. Новые страницы читаем по одной, с паузами и с
соблюдением robots.txt; капчи и защиту от ботов не обходим — такой сайт просто пропускаем.

Со страницы берём разметку schema.org/JobPosting, если она есть, иначе название из H1 или
заголовка и описание из meta description (тоже без ИИ: бесплатного лимита Gemini на тысячи
страниц не хватает). Только если и этого нет — текст страницы разбирает ИИ. На FastCV — краткая выжимка и ссылка
на страницу вакансии на сайте компании. Исчезла из карты сайта — уходит в архив.
"""

from __future__ import annotations

import html
import json
import re
import ssl
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Optional
from urllib import robotparser
from urllib.parse import urlparse

import requests

SOURCE = "career"
USER_AGENT = "Mozilla/5.0 (compatible; FastCVBot/1.0; +https://fastcv.ru)"
ROBOTS_AGENT = "FastCVBot"
RANKING_WEIGHT = 1.0          # как Telegram: иначе тысячи вакансий одной компании закрыли бы ленту
TIME_BUDGET_SECONDS = 7 * 60
MAX_NEW_PER_COMPANY = 150     # за запуск: остальные страницы дочитаем в следующие
PAGE_TEXT_LIMIT = 6000
# Сайты банков подписаны сертификатами НУЦ Минцифры, которых нет в стандартном наборе
RUSSIAN_CA = ["https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer",
              "https://gu-st.ru/content/Other/doc/russian_trusted_sub_ca.cer"]


@dataclass(frozen=True)
class Company:
    key: str              # часть source_post: career/<key>/<id>
    name: str             # название работодателя на FastCV
    site: str             # корень сайта: там robots.txt и карта сайта
    vacancy: str          # регулярное выражение для адреса вакансии; группа 1 — id вакансии
    pause: float = 1.5    # секунд между запросами к сайту
    sitemaps: tuple[str, ...] = ()   # если в robots.txt карты сайта нет


COMPANIES = [
    Company("mts", "МТС", "https://job.mts.ru", r"^https?://job\.mts\.ru/vacancy/(\d+)/?$"),
    Company("vk", "VK", "https://team.vk.company", r"^https?://team\.vk\.company/vacancy/(\d+)/?$"),
    Company("avito", "Авито", "https://career.avito.com", r"^https?://career\.avito\.com/vacancies/[\w-]+/(\d+)/?$"),
    Company("tochka", "Точка", "https://hr.tochka.com", r"^https?://hr\.tochka\.com/vacancies/catalog/([\w-]+)/?$"),
    Company("2gis", "2ГИС", "https://job.2gis.ru", r"^https?://job\.2gis\.ru/vacancies/[\w-]+/(\d+)/?$"),
    Company("ptsecurity", "Positive Technologies", "https://www.ptsecurity.com",
            r"^https?://(?:www\.)?ptsecurity\.com/about/vacancy/([\w-]+)/?$"),
    Company("selectel", "Selectel", "https://selectel.ru", r"^https?://selectel\.ru/careers/all/vacancy/(\d+)/?$"),
    Company("alfa", "Альфа-Банк", "https://job.alfabank.ru",
            r"^https?://job\.alfabank\.ru/vacancies/[^/]+/[^/]+/[^/]*_(\d+)/?$"),
    # Т-Банк: одна вакансия повторяется по городам — id вакансии последний сегмент; сайт
    # ограничивает частоту запросов, поэтому пауза больше
    Company("tbank", "Т-Банк", "https://www.tbank.ru",
            r"^https?://www\.tbank\.ru/career/[\w-]+/vacancy/(?:[^/]+/){1,2}([0-9a-f-]{36})/?$", pause=4.0),
]

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")
_LD = re.compile(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', re.S | re.I)
_NOISE = re.compile(r"<(script|style|noscript|svg|header|footer|nav)\b.*?</\1>", re.S | re.I)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")
_CURRENCY = {"RUB": "RUB", "RUR": "RUB", "USD": "USD", "EUR": "EUR", "KZT": "KZT", "BYN": "BYN"}


def clean(value: object, limit: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = _SPACE.sub(" ", html.unescape(_TAG.sub(" ", value))).strip()
    return text[:limit] or None


def page_text(page: str) -> str:
    """Видимый текст страницы для ИИ: без скриптов, стилей, шапки и подвала."""
    title = clean((_TITLE.search(page) or [None, ""])[1], 300) or ""
    body = clean(_NOISE.sub(" ", page), PAGE_TEXT_LIMIT) or ""
    return f"{title}\n{body}"[:PAGE_TEXT_LIMIT]


def job_posting(page: str) -> Optional[dict]:
    """Первый объект schema.org/JobPosting со страницы (бывает в списке или в @graph)."""
    for block in _LD.findall(page):
        try:
            data = json.loads(block.strip())
        except ValueError:
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for item in items:
            kind = item.get("@type") if isinstance(item, dict) else None
            if kind == "JobPosting" or (isinstance(kind, list) and "JobPosting" in kind):
                return item
    return None


def _salary(posting: dict) -> tuple[Optional[int], Optional[int], Optional[str]]:
    base = posting.get("baseSalary") or {}
    if not isinstance(base, dict):
        return None, None, None
    value = base.get("value") or {}
    if not isinstance(value, dict):
        value = {"value": value}

    def num(x: object) -> Optional[int]:
        try:
            n = int(float(x))
        except (TypeError, ValueError):
            return None
        return n if 0 < n < 100_000_000 else None

    low, high = num(value.get("minValue") or value.get("value")), num(value.get("maxValue"))
    if str(value.get("unitText") or "").upper() == "YEAR":
        low, high = (low // 12 if low else None), (high // 12 if high else None)
    currency = _CURRENCY.get(str(base.get("currency") or "RUB").upper())
    return (low, high, currency) if (low or high) and currency else (None, None, None)


def _city(posting: dict) -> Optional[str]:
    places = posting.get("jobLocation") or []
    for place in places if isinstance(places, list) else [places]:
        address = (place or {}).get("address") if isinstance(place, dict) else None
        if isinstance(address, dict) and address.get("addressLocality"):
            return clean(address["addressLocality"], 100)
        if isinstance(address, str):
            return clean(address.split(",")[0], 100)
    return None


def row_from_posting(posting: dict, company: Company, vid: str, url: str) -> Optional[dict]:
    title = clean(posting.get("title"), 200)
    if not title:
        return None
    low, high, currency = _salary(posting)
    remote = str(posting.get("jobLocationType") or "").upper() == "TELECOMMUTE"
    return {
        "source_post": f"{SOURCE}/{company.key}/{vid}",
        "source_url": url,
        "source_type": "external",
        "title": title,
        "company_name": company.name,
        "description": clean(posting.get("description"), 700),
        "salary_min": low, "salary_max": high, "salary_currency": currency,
        "city": _city(posting),
        "is_remote": remote,
        "work_format": "remote" if remote else None,
        "posted_at": posting.get("datePosted") or datetime.now(timezone.utc).isoformat(),
        "ranking_weight": RANKING_WEIGHT,
    }


_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S | re.I)
_META_DESC = re.compile(r'<meta[^>]+name="description"[^>]+content="([^"]*)"', re.I)
_OG_TITLE = re.compile(r'<meta[^>]+property="og:title"[^>]+content="([^"]*)"', re.I)
_JUNK_TITLES = re.compile(r"^(детальная страница|вакансия|вакансии|карьера|работа)\b.{0,20}$", re.I)
_CITY_IN = re.compile(r"^(.{3,}?)\s+в\s+([А-ЯЁ][а-яё]+(?:[ -][А-ЯЁ][а-яё]+)?)$")
_CITY_FIELD = re.compile(r"Город:\s*([А-ЯЁ][а-яё]+(?:[ -][А-ЯЁ][а-яё]+)?)")


def row_from_meta(page: str, company: Company, vid: str, url: str) -> Optional[dict]:
    """Без ИИ: название из H1 или заголовка страницы, описание из meta description.
    Направление и уровень по названию определит база (триггер vacancies_normalize)."""
    raw = [clean(m.group(1), 300) for m in (_H1.search(page), _OG_TITLE.search(page), _TITLE.search(page)) if m]
    title = next((t for t in raw if t and not _JUNK_TITLES.match(t)), None)
    if not title:
        return None
    # «Вакансия: X», «X - Работа в МТС», «X | Т-Банк», «X вакансия в Москве – Альфа-Банк»
    title = re.sub(r"^вакансия[:\s]+", "", title, flags=re.I)
    title = re.split(r"\s+[-–|]\s+(?:работа\b|вакансии\b|" + re.escape(company.name) + r"|т-банк)", title, flags=re.I)[0]
    title = re.split(r"\s+[|–]\s+", title)[0]
    title = re.sub(r"\s+вакансия\s+в\s+\S+$", "", title, flags=re.I).strip(" ,.-")
    description = clean((_META_DESC.search(page) or [None, None])[1], 700)
    city = None
    if match := _CITY_IN.match(title):          # «Продавец в Москва» (МТС)
        title, city = match.group(1), match.group(2)
    elif "," in title and re.match(r"^[А-ЯЁ][а-яё]+(?:[ -][А-ЯЁ][а-яё]+)?$", title.rsplit(",", 1)[1].strip()):
        title, city = title.rsplit(",", 1)[0], title.rsplit(",", 1)[1].strip()   # «… в AI VK, Москва»
    elif description and (match := _CITY_FIELD.search(description)):
        city = match.group(1)
    if len(title) < 3:
        return None
    return {
        "source_post": f"{SOURCE}/{company.key}/{vid}",
        "source_url": url,
        "source_type": "external",
        "title": title[:200],
        "company_name": company.name,
        "description": description,
        "city": city,
        "is_remote": bool(description and re.search(r"удал[её]нн", description, re.I)),
        "hiring_type": "product",
        "posted_at": datetime.now(timezone.utc).isoformat(),
        "ranking_weight": RANKING_WEIGHT,
    }


def row_from_ai(vacancy, company: Company, vid: str, url: str) -> Optional[dict]:
    """Ответ ИИ (VacancyAI) по тексту страницы → строка vacancies."""
    if not vacancy.is_job or not vacancy.title:
        return None
    return {
        "source_post": f"{SOURCE}/{company.key}/{vid}",
        "source_url": url,
        "source_type": "external",
        "title": vacancy.title.strip()[:200],
        "company_name": company.name,
        "description": (vacancy.description or "").strip()[:700] or None,
        "salary_min": vacancy.salary_min, "salary_max": vacancy.salary_max,
        "salary_currency": vacancy.salary_currency if (vacancy.salary_min or vacancy.salary_max) else None,
        "city": vacancy.city,
        "is_remote": vacancy.is_remote,
        "work_format": vacancy.work_format,
        "stack": [s for s in (vacancy.stack or []) if s][:15],
        "level": vacancy.level,
        "direction": vacancy.direction,
        "experience_min": vacancy.experience_min,
        "scope_note": (vacancy.scope_note or "").strip()[:300] or None,
        "hiring_type": "product",
        "posted_at": datetime.now(timezone.utc).isoformat(),
        "ranking_weight": RANKING_WEIGHT,
    }


class Fetcher:
    """HTTP с паузой на сайт, проверкой robots.txt и российскими сертификатами."""

    def __init__(self, session: Optional[requests.Session] = None, sleep: Callable[[float], None] = time.sleep):
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "ru"})
        self.sleep = sleep
        self.robots: dict[str, robotparser.RobotFileParser] = {}

    def use_russian_ca(self, path: str = "ru-ca-bundle.pem") -> None:
        import certifi
        pems = [open(certifi.where()).read()]
        for url in RUSSIAN_CA:
            try:
                der = requests.get(url, timeout=20).content
                pems.append(ssl.DER_cert_to_PEM_cert(der) if not der.startswith(b"-----") else der.decode())
            except (requests.RequestException, ValueError):
                pass
        with open(path, "w") as f:
            f.write("\n".join(pems))
        self.session.verify = path

    def allowed(self, url: str) -> bool:
        host = urlparse(url)
        root = f"{host.scheme}://{host.netloc}"
        if root not in self.robots:
            rp = robotparser.RobotFileParser()
            try:
                r = self.session.get(root + "/robots.txt", timeout=20)
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
            except requests.RequestException:
                rp.parse([])
            self.robots[root] = rp
        return self.robots[root].can_fetch(ROBOTS_AGENT, url)

    def get(self, url: str, pause: float) -> Optional[str]:
        if not self.allowed(url):
            return None
        self.sleep(pause)
        r = self.session.get(url, timeout=30)
        if r.status_code in (403, 429) or "captcha" in r.url.lower():
            raise Blocked(f"{r.status_code} {urlparse(url).netloc}")
        if r.status_code != 200:
            return None
        if (getattr(r, "encoding", None) or "iso-8859-1").lower() == "iso-8859-1":   # без charset requests гадает неверно
            r.encoding = "utf-8"
        if url.endswith(".gz"):
            import gzip
            try:
                return gzip.decompress(r.content).decode("utf-8", "replace")
            except OSError:
                pass
        return r.text


class Blocked(Exception):
    """Сайт ограничил доступ (403/429/капча) — на этот запуск компанию оставляем."""


def sitemap_vacancies(fetcher: Fetcher, company: Company, limit_maps: int = 40) -> dict[str, str]:
    """id вакансии → адрес страницы, по всем картам сайта компании."""
    pattern = re.compile(company.vacancy)
    maps = list(company.sitemaps)
    if not maps:
        robots = fetcher.get(company.site + "/robots.txt", company.pause) or ""
        maps = re.findall(r"(?im)^sitemap:\s*(\S+)", robots) or [company.site + "/sitemap.xml"]
    found: dict[str, str] = {}
    seen = 0
    while maps and seen < limit_maps:
        url = maps.pop(0)
        seen += 1
        xml = fetcher.get(url, company.pause)
        if not xml:
            continue
        locs = _LOC.findall(xml)
        if "<sitemapindex" in xml:
            # Сначала вложенные карты, похожие на вакансии
            maps = sorted(locs, key=lambda u: not re.search(r"vacanc|vakans|career|job", u, re.I)) + maps
            continue
        for loc in locs:
            match = pattern.match(loc.strip())
            if match:
                found.setdefault(match.group(1), loc.strip())
    return found


def import_careers(store, normalize: Callable[[str], object], fetcher: Optional[Fetcher] = None,
                   companies: list[Company] = COMPANIES, clock: Callable[[], float] = time.monotonic,
                   time_budget: float = TIME_BUDGET_SECONDS) -> dict:
    fetcher = fetcher or Fetcher()
    started = clock()
    stats: dict[str, dict] = {}
    for company in companies:
        if clock() - started > time_budget:
            break
        info = stats.setdefault(company.key, {"new": 0, "saved": 0, "archived": 0})
        try:
            live = sitemap_vacancies(fetcher, company)
            known = store.career_ids(company.key)          # id → в архиве ли
            info["live"] = len(live)
            active = [vid for vid, archived in known.items() if not archived]
            # Пропала из карты сайта — в архив. Карта может не отдаться целиком: не архивируем
            # больше половины разом, это скорее сбой, чем массовое закрытие вакансий
            gone = [vid for vid in active if vid not in live]
            if live and len(gone) <= max(len(active) // 2, 5):
                info["archived"] = store.archive_career(company.key, gone)
            fresh = [vid for vid in live if vid not in known]
            info["new"] = len(fresh)
            for vid in fresh[:MAX_NEW_PER_COMPANY]:
                if clock() - started > time_budget:
                    break
                url = live[vid]
                page = fetcher.get(url, company.pause)
                if not page:
                    continue
                posting = job_posting(page)
                if posting:
                    row = row_from_posting(posting, company, vid, url)
                elif (row := row_from_meta(page, company, vid, url)) is not None:
                    pass
                else:
                    try:
                        row = row_from_ai(normalize(page_text(page)), company, vid, url)
                    except Exception as e:      # ИИ недоступен — остальное дочитаем в следующий раз
                        info["ai"] = f"{type(e).__name__}: {str(e)[:120]}"
                        break
                # Страница не про вакансию (промо, мероприятие) — запоминаем архивной, чтобы не читать снова
                store.upsert_imported([row or {
                    "source_post": f"{SOURCE}/{company.key}/{vid}", "source_url": url, "source_type": "external",
                    "title": "(не вакансия)", "company_name": company.name,
                    "archived_at": datetime.now(timezone.utc).isoformat()}])
                info["saved"] += 1 if row else 0
        except Blocked as e:
            info["blocked"] = str(e)
        except requests.RequestException as e:
            info["error"] = f"{type(e).__name__}: {str(e)[:120]}"
        if clock() - started > time_budget:
            info["stopped"] = "time budget"
    return stats
