"""Открытые API систем найма: перенос полей, склейка городов, архив пропавших."""

import ats

GREENHOUSE = {"jobs": [
    {"id": 11, "title": "3D Artist", "absolute_url": "https://job-boards.greenhouse.io/t/jobs/11",
     "location": {"name": "Minsk"}, "content": "&lt;p&gt;Make &lt;b&gt;art&lt;/b&gt;&lt;/p&gt;", "first_published": "2026-10-20T10:00:00Z"},
    {"id": 12, "title": "3D Artist", "absolute_url": "https://job-boards.greenhouse.io/t/jobs/12",
     "location": {"name": "Limassol, Cyprus"}, "content": "x", "first_published": "2026-10-21T10:00:00Z"},
    {"id": 13, "title": "Data Analyst", "absolute_url": "https://job-boards.greenhouse.io/t/jobs/13",
     "location": {"name": "Remote Europe"}, "content": "y", "first_published": "2026-10-22T10:00:00Z"},
]}
WORKABLE = {"jobs": [{"shortcode": "AB12", "title": "Level Designer", "url": "https://apply.workable.com/s/j/AB12",
                      "city": "Yerevan", "country": "Armenia", "telecommuting": False, "description": "<p>Levels</p>",
                      "published_on": "2026-10-25"}]}


class Store:
    def __init__(self, known=None):
        self.known, self.rows, self.archived = known or {}, [], []

    def career_ids(self, company):
        return self.known

    def archive_career(self, company, ids):
        self.archived += ids
        return len(ids)

    def upsert_imported(self, rows):
        self.rows += rows
        return len(rows)


def get(url):
    return GREENHOUSE if "greenhouse" in url else WORKABLE


def test_same_title_in_many_cities_is_one_vacancy():
    rows = ats.rows_for(ats.BOARDS[1], ats.fetch_jobs(ats.BOARDS[1], get))
    art = next(r for r in rows if r["title"] == "3D Artist")
    assert len(rows) == 2 and art["source_post"] == "career/tripledot/11"
    assert art["city"] == "Минск" and art["description"].startswith("Города: Минск, Лимассол. Make art")
    assert art["direction"] == "gamedev" and art["company_name"] == "Tripledot Studios"
    analyst = next(r for r in rows if r["title"] == "Data Analyst")
    assert analyst["city"] is None and analyst["is_remote"] and analyst["work_format"] == "remote"


def test_workable_fields():
    [row] = ats.rows_for(ats.BOARDS[0], ats.fetch_jobs(ats.BOARDS[0], get))
    assert row["source_post"] == "career/sperasoft/AB12" and row["city"] == "Ереван"
    assert row["description"] == "Levels" and not row["is_remote"]


def test_gone_vacancies_archived_and_new_counted():
    store = Store(known={"11": False, "99": False, "13": True})
    stats = ats.import_boards(store, get, [ats.BOARDS[1]])
    assert store.archived == ["99"]
    assert stats["tripledot"] == {"archived": 1, "live": 2, "new": 0}
    assert all(r["archived_at"] is None for r in store.rows)   # вернувшаяся 13 снова в ленте


def test_api_failure_archives_nothing():
    def broken(url):
        raise ats.requests.ConnectionError("down")
    store = Store(known={"11": False})
    stats = ats.import_boards(store, broken, [ats.BOARDS[1]])
    assert stats["tripledot"] == {"error": "ConnectionError"} and store.archived == []


def test_city_of():
    assert ats.city_of("Belgrade, Serbia") == ("Белград", False)
    assert ats.city_of("Estonia - Remote") == (None, True)
    assert ats.city_of("Amsterdam, Netherlands; Berlin, Germany") == ("Амстердам", False)
