"""SuperJob: перенос полей и обход окнами по времени без сети."""

from datetime import datetime, timedelta, timezone

import superjob

SAMPLE = {
    "id": 50147872, "profession": "Сборщик заказов", "firm_name": "Пятёрочка",
    "payment_from": 37000, "payment_to": 52000, "currency": "rub", "agreement": False,
    "link": "https://shahty.superjob.ru/vakansii/sborschik-zakazov-50147872.html",
    "date_published": 1792803660, "is_archive": False, "is_closed": False, "anonymous": False,
    "experience": {"id": 3, "title": "От 3 лет"}, "type_of_work": {"id": 6, "title": "Полный рабочий день"},
    "place_of_work": {"id": 0, "title": "Не имеет значения"}, "town": {"id": 748, "title": "Шахты"},
    "catalogues": [{"id": 86, "title": "Транспорт, логистика, ВЭД"}],
    "candidat": "«Пятёрочка» приглашает: <b>сборщик заказов</b>", "trud_vsem": False,
}


def test_map_vacancy_fields():
    row = superjob.map_vacancy(SAMPLE)
    assert row["source_post"] == "superjob/50147872" and row["source_url"].endswith("50147872.html")
    assert (row["salary_min"], row["salary_max"], row["salary_currency"]) == (37000, 52000, "RUB")
    assert row["city"] == "Шахты" and row["company_name"] == "Пятёрочка"
    assert row["direction"] == "logistics" and row["experience_min"] == 3.0 and row["level"] == "middle"
    assert row["description"] == "«Пятёрочка» приглашает: сборщик заказов"
    assert row["posted_at"].startswith("2026-")


def test_map_vacancy_remote_anonymous_it_and_closed():
    row = superjob.map_vacancy({**SAMPLE, "anonymous": True, "payment_from": 0, "payment_to": 0,
                                "place_of_work": {"id": 2, "title": "Удалённая работа (на дому)"},
                                "catalogues": [{"title": "IT, Интернет, связь, телеком"}]})
    assert row["company_name"] is None and row["salary_min"] is None and row["salary_currency"] is None
    assert row["is_remote"] and row["work_format"] == "remote"
    assert row["direction"] is None          # IT — направление определит база по названию
    assert superjob.map_vacancy({**SAMPLE, "is_closed": True}) is None


class Store:
    def __init__(self, stored=0):
        self.stored, self.rows, self.settings, self.pruned = stored, [], {}, None

    def prune_source(self, source, keep_hours):
        self.pruned = (source, keep_hours)
        return {"removed": 2, "archived": 0}

    def count_source(self, source):
        return self.stored

    def get_setting(self, key):
        return self.settings.get(key)

    def set_setting(self, key, value):
        self.settings[key] = value

    def upsert_imported(self, rows):
        self.rows += rows
        return len(rows)


NOW = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)


def feed(per_hour):
    """Фейковый API: per_hour вакансий в каждом часе, равномерно; честный total и пагинация."""
    calls = []

    def fetch(params):
        calls.append(params)
        a, b = params["date_published_from"], params["date_published_to"] + 1
        stamps = [t for t in range(int((NOW - timedelta(hours=10)).timestamp()), int(NOW.timestamp()), 3600 // per_hour)
                  if a <= t < b]
        page = stamps[params["page"] * params["count"]:(params["page"] + 1) * params["count"]]
        objects = [{**SAMPLE, "id": t, "date_published": t} for t in page]
        return {"total": len(stamps), "more": (params["page"] + 1) * params["count"] < min(len(stamps), 500), "objects": objects}

    return fetch, calls


def test_walks_keep_window_and_splits_windows_over_api_limit():
    fetch, calls = feed(per_hour=720)          # 720 в час — часовое окно больше лимита 500
    store = Store()
    stats = superjob.import_superjob(store, fetch, now=NOW, clock=lambda: 0)
    assert store.pruned == ("superjob", superjob.KEEP_HOURS)
    assert stats["saved"] == 720 * superjob.KEEP_HOURS and stats["stopped"] is None
    assert len({r["source_post"] for r in store.rows}) == len(store.rows)      # без повторов
    assert all(p["date_published_from"] >= int((NOW - timedelta(hours=superjob.KEEP_HOURS)).timestamp()) for p in calls)
    assert store.settings[superjob.CURSOR_KEY] == NOW.isoformat()


def test_next_run_continues_from_cursor_and_skips_closed():
    fetch, calls = feed(per_hour=60)
    store = Store()
    store.settings[superjob.CURSOR_KEY] = (NOW - timedelta(hours=1)).isoformat()
    superjob.import_superjob(store, fetch, now=NOW, clock=lambda: 0)
    assert min(p["date_published_from"] for p in calls) == int((NOW - timedelta(minutes=70)).timestamp())

    dup = Store()
    # trud_vsem в ответе есть у всех вакансий — это не признак дубля, сохраняем
    page = [{**SAMPLE, "trud_vsem": True}, {**SAMPLE, "id": 2, "is_archive": True}]
    stats = superjob.import_superjob(dup, lambda p: {"total": 2, "more": False, "objects": page}, now=NOW, clock=lambda: 0)
    assert stats["saved"] > 0 and stats["skipped"] > 0


def test_stops_at_storage_cap_and_time_budget():
    fetch, _ = feed(per_hour=60)
    full = Store(stored=superjob.MAX_STORED)
    stats = superjob.import_superjob(full, fetch, now=NOW, clock=lambda: 0)
    assert stats["stopped"] == "storage cap" and full.pruned and stats["removed"] == 2

    ticks = iter(range(0, 10_000, 100))
    slow = Store()
    stats = superjob.import_superjob(slow, fetch, now=NOW, clock=lambda: next(ticks), time_budget=250)
    assert stats["stopped"] == "time budget" and superjob.CURSOR_KEY in slow.settings


def test_it_rubric_gives_direction():
    it = [{"key": 33, "title": "IT, Интернет, связь, телеком", "positions": [{"key": 56, "title": "Тестирование, QA"}]}]
    assert superjob.map_vacancy({**SAMPLE, "catalogues": it})["direction"] == "qa"
    dev = [{"key": 33, "title": "IT", "positions": [{"key": 48, "title": "Разработка, программирование"}]}]
    assert superjob.map_vacancy({**SAMPLE, "catalogues": dev})["direction"] is None   # по названию


def test_it_pass_takes_30_days_and_removes_closed():
    it = [{"key": 33, "title": "IT", "positions": [{"key": 628, "title": "DevOps"}]}]
    day = 24 * 3600
    stamps = [int((NOW - timedelta(days=d)).timestamp()) for d in (1, 5, 12, 29)]
    calls = []

    def fetch(params):
        calls.append(params)
        assert params["catalogues"] == superjob.IT_CATALOGUE
        a, b = params["date_published_from"], params["date_published_to"] + 1
        objects = [{**SAMPLE, "id": t, "date_published": t, "profession": "DevOps-инженер", "catalogues": it}
                   for t in stamps if a <= t < b]
        return {"total": len(objects), "more": False, "objects": objects}

    class ItStore(Store):
        def prune_superjob_closed(self, open_ids, since):
            self.closed_args = (open_ids, since)
            return 3

    store = ItStore()
    result = superjob.import_it(store, fetch, now=NOW)
    assert result == {"it_seen": 4, "it_saved": 4, "it_closed": 3}
    assert sorted(store.closed_args[0]) == sorted(str(t) for t in stamps)
    assert store.closed_args[1] == NOW - timedelta(days=30)
    assert {r["direction"] for r in store.rows} == {"devops"}
    assert day  # окна по 3 дня: 10 запросов на 30 дней
    assert len(calls) == 10


def test_it_pass_skips_old_non_it_titles():
    it = [{"key": 33, "title": "IT", "positions": [{"key": 55, "title": "Телекоммуникации и связь"}]}]
    old = int((NOW - timedelta(days=3)).timestamp())

    def fetch(params):
        a, b = params["date_published_from"], params["date_published_to"] + 1
        objects = [{**SAMPLE, "id": old + i, "date_published": old, "profession": p, "catalogues": it}
                   for i, p in enumerate(["Монтажник связи", "Python-разработчик"]) if a <= old < b]
        return {"total": len(objects), "more": False, "objects": objects}

    class ItStore(Store):
        def prune_superjob_closed(self, open_ids, since):
            return 0

    store = ItStore()
    superjob.import_it(store, fetch, now=NOW)
    assert [r["title"] for r in store.rows] == ["Python-разработчик"]
