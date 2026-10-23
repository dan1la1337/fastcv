"""«Работа России»: перенос полей и обход регионов без сети."""

from datetime import datetime, timezone

import trudvsem

SAMPLE = {
    "id": "432e9fd8-f059-11f0-b746-7ffc9083893e",
    "region": {"region_code": "5500000000000", "name": "Омская область"},
    "company": {"name": "БДОУ Г. ОМСКА \"ДЕТСКИЙ САД № 283\"", "hr-agency": False},
    "date_modify": "2026-10-23T13:40:00+0300",
    "creation-date": "2026-01-13",
    "salary": "от 31157", "salary_min": 31157, "salary_max": 31157,
    "job-name": "Няня",
    "vac_url": "https://trudvsem.ru/vacancy/card/1025500522431/432e9fd8",
    "schedule": "Полный рабочий день", "employment": "Полная занятость",
    "requirements": "<p>Среднее образование.</p>",
    "duty": "Уборка &amp; проветривание.",
    "requirement": {"education": "Среднее", "experience": 3},
    "addresses": {"address": [{"location": "644000, Омская обл, г Омск, ул Ленина, д 1"}]},
    "contact_list": [{"contact_type": "Эл. почта", "contact_value": "hr@example.ru"}, {"contact_type": "Телефон", "contact_value": "+7"}],
}


def test_map_vacancy_fields():
    row = trudvsem.map_vacancy(SAMPLE)
    assert row["source_post"] == "trudvsem/432e9fd8-f059-11f0-b746-7ffc9083893e"
    assert row["title"] == "Няня" and row["city"] == "Омск"
    assert (row["salary_min"], row["salary_max"], row["salary_currency"]) == (31157, None, "RUB")
    assert row["description"] == "Уборка & проветривание. Среднее образование."
    assert (row["experience_min"], row["level"]) == (3.0, "middle")
    assert (row["contact_type"], row["contact_value"]) == ("email", "hr@example.ru")
    assert row["work_format"] is None and row["is_remote"] is False


def test_map_vacancy_remote_federal_city_and_missing_title():
    row = trudvsem.map_vacancy({**SAMPLE, "region": {"name": "г. Москва"}, "schedule": "Удаленная работа",
                                "requirement": {"experience": 0}, "company": {"name": "Кадры", "hr-agency": True}})
    assert row["city"] == "Москва" and row["work_format"] == "remote" and row["level"] is None
    assert row["hiring_type"] == "agency"
    assert trudvsem.map_vacancy({**SAMPLE, "job-name": ""}) is None


class Store:
    def __init__(self, stored=0):
        self.stored, self.rows, self.settings, self.pruned = stored, [], {}, None

    def count_trudvsem(self):
        return self.stored

    def get_setting(self, key):
        return self.settings.get(key)

    def set_setting(self, key, value):
        self.settings[key] = value

    def upsert_trudvsem(self, rows):
        self.rows += rows
        return len(rows)

    def prune_trudvsem(self, keep_days):
        self.pruned = keep_days
        return {"removed": 3, "archived": 1}


def test_import_walks_regions_with_shallow_pages_and_prunes():
    calls = []

    def fetch(url, params):
        calls.append((url, params["offset"]))
        if url.endswith("/7700000000000"):
            n = trudvsem.PAGE if params["offset"] == 0 else 5
            return {"results": {"vacancies": [{"vacancy": {**SAMPLE, "id": f"m{params['offset']}-{i}"}} for i in range(n)]}}
        return {"results": {"vacancies": []}}

    store = Store()
    now = datetime(2026, 10, 24, 6, 0, tzinfo=timezone.utc)
    stats = trudvsem.import_trudvsem(store, fetch=fetch, now=now)
    assert stats["saved"] == trudvsem.PAGE + 5 and stats["removed"] == 3
    assert ("https://opendata.trudvsem.ru/api/v1/vacancies/region/7700000000000", 1) in calls
    assert len(calls) == 99 + 1  # каждый регион по разу и вторая страница Москвы
    assert store.settings[trudvsem.SYNC_KEY] == now.isoformat() and store.pruned == trudvsem.KEEP_DAYS


def test_import_stops_at_storage_cap_and_survives_region_errors():
    full = Store(stored=trudvsem.MAX_STORED)
    stats = trudvsem.import_trudvsem(full, fetch=lambda u, p: {})
    # На потолке новые не берём, но устаревшие всё равно убираем — иначе застряли бы навсегда
    assert "skipped" in stats and full.pruned == trudvsem.KEEP_DAYS and stats["removed"] == 3

    def flaky(url, params):
        raise trudvsem.requests.ConnectionError("down")

    stats = trudvsem.import_trudvsem(Store(), fetch=flaky)
    assert stats["failed_regions"] == 99 and stats["saved"] == 0


def test_direction_from_sphere():
    def d(sphere):
        return trudvsem.map_vacancy({**SAMPLE, "category": {"specialisation": sphere}})["direction"]

    assert d("Информационные технологии, телекоммуникации, связь") is None   # решит база по названию
    assert d("Маркетинг, реклама, PR") == "marketing"
    assert d("Продажи, закупки, снабжение, торговля") == "sales"
    assert d("Бухгалтерия, налоги, управленческий учет") == "finance"
    assert d("Государственная служба, некоммерческие организации") == "government"
    assert d("Здравоохранение и социальное обеспечение") == "medicine"
    assert d("Какая-то новая сфера") is None
    assert trudvsem.map_vacancy(SAMPLE)["direction"] is None


def test_walk_resumes_from_region_where_budget_ran_out():
    store, now = Store(), datetime(2026, 10, 24, 12, tzinfo=timezone.utc)
    calls = []

    def fetch(url, params):
        calls.append((url.rsplit("/", 1)[1], params["modifiedFrom"]))
        return {"results": {"vacancies": [{"vacancy": {**SAMPLE, "id": f"{len(calls)}-{i}"}} for i in range(100)]
                            if len(calls) % 2 else [{"vacancy": SAMPLE}]}}

    first = trudvsem.import_trudvsem(store, fetch=fetch, now=now, max_rows=303)
    assert first["resume_region"] == 3 and trudvsem.SYNC_KEY not in store.settings
    since = calls[0][1]

    later = datetime(2026, 10, 24, 18, tzinfo=timezone.utc)
    calls.clear()
    second = trudvsem.import_trudvsem(store, fetch=fetch, now=later, max_rows=10_000)
    assert calls[0] == ("0400000000000", since)          # тот же регион и та же точка отсчёта
    assert second["resume_region"] is None
    assert store.settings[trudvsem.SYNC_KEY] == now.isoformat() and store.settings[trudvsem.CURSOR_KEY] == ""


def test_walk_stops_on_time_and_resumes_later():
    store, ticks = Store(), iter(range(0, 10_000, 60))
    stats = trudvsem.import_trudvsem(store, fetch=lambda u, p: {"results": {"vacancies": []}},
                                     clock=lambda: next(ticks), time_budget=150)
    assert stats["resume_region"] == 2 and trudvsem.SYNC_KEY not in store.settings
