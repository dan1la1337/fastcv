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
# Без JobPosting и без заголовков — остаётся только разбор текста ИИ
PAGE_TEXT = "<html><nav>меню</nav><main>Ищем тестировщика, опыт от 2 лет</main></html>"


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
        "x5tech": ("https://x5.tech/vacancy/e0592e04-4530-4f42-a9ed-0946095e6d6b", "e0592e04-4530-4f42-a9ed-0946095e6d6b"),
        "sber": ("https://rabota.sber.ru/search/starshiy-klientskiy-menedzher-4482579/", "4482579"),
        "tbank": ("https://www.tbank.ru/career/it/vacancy/murom/product-manager-v-t-bank/019e8406-0ea0-7175-a543-e47fe3fe711c/",
                  "019e8406-0ea0-7175-a543-e47fe3fe711c"),
    }
    import re
    for key, (url, vid) in samples.items():
        assert re.match(by_key[key].vacancy, url).group(1) == vid, key
    prefer = by_key["sber"].prefer
    assert re.search(prefer, "https://rabota.sber.ru/search/razrabotchik-java-4482580/")
    assert re.search(prefer, "https://rabota.sber.ru/search/it-arhitektor-4482581/")
    assert not re.search(prefer, "https://rabota.sber.ru/search/starshiy-klientskiy-menedzher-4482579/")


def test_title_city_and_description_from_page_heads_without_ai():
    def meta(page):
        row = careers.row_from_meta(page, CO, "1", "https://job.acme.ru/vacancy/1")
        return (row["title"], row["city"]) if row else None

    mts = careers.Company("mts", "МТС", "https://job.mts.ru", r".*")
    page = ("<title>Продавец (Розничная сеть МТС) в Москва - Работа в МТС</title><h1>Детальная страница вакансии</h1>"
            '<meta name="description" content="Ищете работу? Присоединяйтесь к команде МТС!">')
    row = careers.row_from_meta(page, mts, "1", "u")
    assert (row["title"], row["city"], row["company_name"]) == ("Продавец (Розничная сеть МТС)", "Москва", "МТС")
    assert row["description"].startswith("Ищете работу")
    assert meta("<h1>Go Platform инженер в AI VK, Москва</h1>") == ("Go Platform инженер в AI VK", "Москва")
    assert meta('<title>Вакансия: Ведущий специалист по охране труда</title><h1>Ведущий специалист по охране труда</h1>'
                '<meta name="description" content="Вакансия в Selectel. Город: Москва. Белая зарплата">') == (
        "Ведущий специалист по охране труда", "Москва")
    assert meta("<title>Вакансия Продакт-менеджер | Т-Банк ex. Тинькофф</title>") == ("Продакт-менеджер", None)
    assert meta("<h1>Руководитель направления (юридические лица)</h1>") == ("Руководитель направления (юридические лица)", None)
    assert meta("<h1>Вакансии</h1>") is None


def test_preferred_sections_first_and_direction_from_section():
    co = careers.Company("acme", "Acme", "https://job.acme.ru", r"^https://job\.acme\.ru/vacancy/(?:\w+/)?(\d+)/?$",
                         pause=0, prefer=r"/it/", categories=(("/ds/", "data_ml"),))
    sitemap = """<urlset><url><loc>https://job.acme.ru/vacancy/shop/1</loc></url>
    <url><loc>https://job.acme.ru/vacancy/ds/2</loc></url><url><loc>https://job.acme.ru/vacancy/it/3</loc></url></urlset>"""
    page = "<h1>Старший DS-инженер</h1>"
    fetcher = site(**{"https://job.acme.ru/sitemap-vacancies.xml": sitemap, "https://job.acme.ru/vacancy/shop/1": page,
                      "https://job.acme.ru/vacancy/ds/2": page, "https://job.acme.ru/vacancy/it/3": page})
    store = Store()
    careers.import_careers(store, ai, fetcher, [co], clock=lambda: 0)
    pages = [u for u in fetcher.session.calls if "/vacancy/" in u]
    assert pages[0].endswith("/it/3")
    rows = {r["source_post"]: r for r in store.rows}
    assert rows["career/acme/2"]["direction"] == "data_ml" and "direction" not in rows["career/acme/1"]


def test_company_preferences_are_valid_regexes():
    import re
    for co in careers.COMPANIES:
        re.compile(co.prefer)
        assert all(d in {"data_ml", "product", "analytics", "design", "qa", "backend", "frontend", "devops"}
                   for _, d in co.categories)


def test_time_is_shared_between_companies():
    t = [0.0]

    def clock():
        t[0] += 10          # каждый шаг — 10 «секунд»
        return t[0]

    other = careers.Company("beta", "Beta", "https://job.acme.ru", r"^https://job\.acme\.ru/vacancy/(\d+)/?$", pause=0)
    many = "<urlset>" + "".join(f"<url><loc>https://job.acme.ru/vacancy/{i}</loc></url>" for i in range(1, 40)) + "</urlset>"
    pages = {f"https://job.acme.ru/vacancy/{i}": PAGE_LD for i in range(1, 40)}
    store = Store()
    stats = careers.import_careers(store, ai, site(**{"https://job.acme.ru/sitemap-vacancies.xml": many}, **pages),
                                   [CO, other], clock=clock, time_budget=400)
    assert stats["acme"].get("stopped") == "company share"
    assert stats["beta"]["saved"] > 0
