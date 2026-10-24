"""Сайты компаний: карта сайта, JobPosting, ИИ-разбор, архив пропавших — без сети."""

import json
from types import SimpleNamespace

import careers

CO = careers.Company("acme", "Acme", "https://job.acme.ru", r"^https://job\.acme\.ru/vacancy/(\d+)/?$", pause=0)

ROBOTS = "User-agent: *\nDisallow: /admin\nSitemap: https://job.acme.ru/sitemap.xml\n"
INDEX = """<sitemapindex><sitemap><loc>https://job.acme.ru/sitemap-pages.xml</loc></sitemap>
<sitemap><loc>https://job.acme.ru/sitemap-vacancies.xml</loc></sitemap></sitemapindex>"""
VACANCIES = """<urlset><url><loc>https://job.acme.ru/vacancy/1</loc></url>
<url><loc>https://job.acme.ru/vacancy/2</loc></url><url><loc>https://job.acme.ru/about</loc></url></urlset>"""
POSTING = {"@context": "https://schema.org", "@type": "JobPosting", "title": "Python-разработчик",
           "description": "<p>Пишем <b>бэкенд</b></p>", "datePosted": "2026-10-20",
           "baseSalary": {"@type": "MonetaryAmount", "currency": "RUB",
                          "value": {"minValue": 200000, "maxValue": 300000, "unitText": "MONTH"}},
           "jobLocation": {"@type": "Place", "address": {"addressLocality": "Москва"}}}
PAGE_LD = f'<html><script type="application/ld+json">{json.dumps(POSTING, ensure_ascii=False)}</script></html>'
PAGE_TEXT = "<html><title>QA в Acme</title><nav>меню</nav><main>Ищем тестировщика, опыт от 2 лет</main></html>"


class FakeSession:
    def __init__(self, pages):
        self.pages, self.headers, self.verify, self.calls = pages, {}, True, []

    def get(self, url, timeout=0):
        self.calls.append(url)
        text = self.pages.get(url)
        return SimpleNamespace(status_code=200 if text is not None else 404, text=text or "", url=url, content=b"")


class Store:
    def __init__(self, known=None):
        self.known, self.rows, self.archived = known or {}, [], []

    def career_ids(self, key):
        return self.known

    def archive_career(self, key, ids):
        self.archived += ids
        return len(ids)

    def upsert_imported(self, rows):
        self.rows += rows
        return len(rows)


def site(**extra):
    pages = {"https://job.acme.ru/robots.txt": ROBOTS, "https://job.acme.ru/sitemap.xml": INDEX,
             "https://job.acme.ru/sitemap-vacancies.xml": VACANCIES, "https://job.acme.ru/sitemap-pages.xml": "<urlset/>",
             "https://job.acme.ru/vacancy/1": PAGE_LD, "https://job.acme.ru/vacancy/2": PAGE_TEXT}
    pages.update(extra)
    return careers.Fetcher(FakeSession(pages), sleep=lambda s: None)


def ai(text):
    assert "Ищем тестировщика" in text and "меню" not in text      # шапку и меню ИИ не видит
    return SimpleNamespace(is_job=True, title="QA-инженер", description="Тестирование", salary_min=None,
                           salary_max=None, salary_currency=None, city="Москва", is_remote=False,
                           work_format="office", stack=["Python"], level="middle", direction="qa",
                           experience_min=2.0, scope_note=None)


def test_sitemap_index_is_followed_and_only_vacancy_urls_kept():
    found = careers.sitemap_vacancies(site(), CO)
    assert found == {"1": "https://job.acme.ru/vacancy/1", "2": "https://job.acme.ru/vacancy/2"}


def test_new_vacancies_from_jobposting_and_ai_and_gone_ones_archived():
    store = Store(known={"9": False})
    stats = careers.import_careers(store, ai, site(), [CO], clock=lambda: 0)
    rows = {r["source_post"]: r for r in store.rows}
    ld, by_ai = rows["career/acme/1"], rows["career/acme/2"]
    assert (ld["title"], ld["salary_min"], ld["salary_max"], ld["city"]) == ("Python-разработчик", 200000, 300000, "Москва")
    assert ld["description"] == "Пишем бэкенд" and ld["company_name"] == "Acme" and ld["source_url"].endswith("/vacancy/1")
    assert by_ai["title"] == "QA-инженер" and by_ai["direction"] == "qa" and by_ai["level"] == "middle"
    assert store.archived == ["9"] and stats["acme"]["saved"] == 2


def test_known_pages_are_not_refetched_and_not_a_job_is_remembered_archived():
    fetcher = site()
    store = Store(known={"1": False})
    careers.import_careers(store, lambda text: SimpleNamespace(is_job=False, title=None), fetcher, [CO], clock=lambda: 0)
    assert "https://job.acme.ru/vacancy/1" not in fetcher.session.calls
    assert store.rows[0]["source_post"] == "career/acme/2" and store.rows[0]["archived_at"]


def test_robots_disallow_and_blocking_are_respected():
    closed = site(**{"https://job.acme.ru/robots.txt": "User-agent: *\nDisallow: /\n"})
    stats = careers.import_careers(Store(), ai, closed, [CO], clock=lambda: 0)
    assert stats["acme"]["live"] == 0 and not any("/vacancy/" in u for u in closed.session.calls)

    blocked = site()
    blocked.session.get = lambda url, timeout=0: SimpleNamespace(status_code=429, text="", url=url, content=b"")
    blocked.robots["https://job.acme.ru"] = careers.robotparser.RobotFileParser()
    blocked.robots["https://job.acme.ru"].parse([])
    assert "blocked" in careers.import_careers(Store(), ai, blocked, [CO], clock=lambda: 0)["acme"]


def test_mass_disappearance_is_not_archived():
    store = Store(known={str(i): False for i in range(10, 30)})   # 20 известных, в карте только 2 новых
    careers.import_careers(store, ai, site(), [CO], clock=lambda: 0)
    assert store.archived == []


def test_company_patterns_match_real_urls():
    by_key = {c.key: c for c in careers.COMPANIES}
    samples = {
        "mts": ("https://job.mts.ru/vacancy/80555827261406669", "80555827261406669"),
        "vk": ("http://team.vk.company/vacancy/46274/", "46274"),
        "avito": ("https://career.avito.com/vacancies/razrabotka/19456/", "19456"),
        "alfa": ("https://job.alfabank.ru/vacancies/moskva/central-office/alfa-agent_39197", "39197"),
        "tbank": ("https://www.tbank.ru/career/it/vacancy/murom/product-manager-v-t-bank/019e8406-0ea0-7175-a543-e47fe3fe711c/",
                  "019e8406-0ea0-7175-a543-e47fe3fe711c"),
    }
    import re
    for key, (url, vid) in samples.items():
        assert re.match(by_key[key].vacancy, url).group(1) == vid, key
