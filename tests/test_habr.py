"""RSS-лента «Хабр Карьеры»: разбор вакансий, отбор по названию, архив пропавших."""

from pathlib import Path

import careers
import habr

FEED = (Path(__file__).parent / "fixtures" / "habr_pm.xml").read_text(encoding="utf-8")
EMPTY = '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>'


class Store:
    def __init__(self, known=None):
        self.known, self.rows, self.archived = known or {}, [], []

    def career_ids(self, company):
        assert company == "habr"
        return self.known

    def archive_career(self, company, ids):
        self.archived += ids
        return len(ids)

    def upsert_imported(self, rows):
        self.rows += rows
        return len(rows)


def get_pm(url):
    """Лента менеджеров — одна страница, лента аналитиков пуста."""
    return FEED if "s[]=34" in url and "page=1" in url else EMPTY


def test_rss_items_become_vacancies():
    rows = {r["title"]: r for r in habr.fetch_rows(get_pm)}
    pm = rows["Senior менеджер проекта"]
    assert pm["source_post"] == "career/habr/1000166713"
    assert pm["source_url"] == "https://career.habr.com/vacancies/1000166713"
    assert pm["company_name"] == "AGIMA"
    assert (pm["salary_min"], pm["salary_max"], pm["salary_currency"]) == (None, 180000, "RUB")
    assert pm["is_remote"] and pm["work_format"] == "remote" and pm["city"] is None
    assert pm["direction"] == "product"
    assert pm["posted_at"].startswith("2026-11-15T14:30:15")
    assert pm["description"].startswith("До 180 000 ₽. Полный рабочий день. Можно удалённо.")
    delivery = rows["Delivery Lead"]
    assert (delivery["city"], delivery["country"], delivery["is_remote"]) == ("Москва", "Россия", False)


def test_only_pm_titles_are_taken_from_pm_specialisations():
    titles = {r["title"] for r in habr.fetch_rows(get_pm)}
    assert titles == {"Senior менеджер проекта", "Delivery Lead", "Project Manager"}


def test_salary_and_places():
    assert habr.parse_salary("Москва (Россия). От 4 500 $ до 6 000 $. Полный рабочий день.") == (4500, 6000, "USD")
    assert habr.parse_salary("От 450 000 ₽. Можно удалённо.") == (450000, None, "RUB")
    assert habr.parse_salary("Москва (Россия). Полный рабочий день.") == (None, None, None)
    assert habr.parse_places("Москва (Россия), Белград (Сербия), Лимассол (Кипр). Полный рабочий день.") == (
        ["Москва", "Белград", "Лимассол"], ["Россия", "Сербия", "Кипр"])
    assert habr.parse_places("Полный рабочий день. Можно удалённо.") == ([], [])


def test_pages_until_empty_and_all_feeds():
    urls = []

    def get(url):
        urls.append(url)
        return FEED if "page=1" in url else EMPTY
    habr.fetch_rows(get)
    assert len(urls) == 4   # по две страницы на ленту: вторая пустая
    assert all(u.startswith("https://career.habr.com/vacancies/rss?s[]=") for u in urls)


def test_import_archives_gone_and_keeps_on_failure():
    store = Store({"1000166713": False, "999": False, "1000169770": True})
    info = habr.import_habr(store, get_pm)
    assert info == {"archived": 1, "live": 3, "new": 1}
    assert store.archived == ["999"]
    assert all(r["archived_at"] is None for r in store.rows)

    # Страница не прочиталась — ни записи, ни архива
    store = Store({"999": False})
    assert habr.import_habr(store, lambda url: None) == {"error": "feed"}
    assert store.archived == [] and store.rows == []


def test_robots_and_user_agent_via_fetcher():
    class Response:
        def __init__(self, url, text):
            self.url, self.text, self.status_code, self.encoding = url, text, 200, "utf-8"
            self.content = text.encode()

    class Session:
        def __init__(self):
            self.headers, self.urls = {}, []

        def get(self, url, timeout):
            self.urls.append(url)
            if url.endswith("/robots.txt"):
                return Response(url, "User-agent: *\nDisallow: /v1\nDisallow: /vacancies/*/responses\n")
            return Response(url, FEED if "page=1" in url else EMPTY)

    session = Session()
    store = Store()
    info = habr.run(store, careers.Fetcher(session, sleep=lambda s: None))
    assert info["live"] == 3
    assert "FastCVBot" in session.headers["User-Agent"]
    assert session.urls[0] == "https://career.habr.com/robots.txt"
