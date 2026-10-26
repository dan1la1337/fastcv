from types import SimpleNamespace

import demo_reset


def users(*emails):
    return [SimpleNamespace(id=f"id-{e}", email=e) for e in emails]


def test_finds_users_across_pages_case_insensitive():
    pages = {1: users(*[f"u{i}@x.ru" for i in range(2)]), 2: users("Demo@FastCV.test", "hr@fastcv.test")}
    seen = []

    def list_page(page):
        seen.append(page)
        return pages.get(page, [])

    found = demo_reset.find_user_ids(list_page, ["demo@fastcv.test", "HR@fastcv.test"], per_page=2)
    assert found == {"demo@fastcv.test": "id-Demo@FastCV.test", "hr@fastcv.test": "id-hr@fastcv.test"}
    assert seen == [1, 2]


def test_stops_when_pages_end_without_match():
    found = demo_reset.find_user_ids(lambda page: users("a@x.ru") if page == 1 else [], ["b@x.ru"], per_page=1)
    assert found == {}


def test_requires_env(monkeypatch, capsys):
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DEMO_CANDIDATE_EMAIL", "DEMO_EMPLOYER_EMAIL"):
        monkeypatch.delenv(key, raising=False)
    assert demo_reset.main([]) == 2
    assert "DEMO_CANDIDATE_EMAIL" in capsys.readouterr().out
