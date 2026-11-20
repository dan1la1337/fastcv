"""Менеджеры проектов и продукта → направление product во всех источниках без сети."""

import ats
import main
import roles
import superjob
import trudvsem
from main import Post, process_post
from tests.test_scraper import FakeQuery, FakeStore, job


def test_pm_titles_go_to_product():
    for title in ["Project Manager", "Руководитель IT-проектов", "Delivery Lead", "Руководитель проектного офиса",
                  "Product Owner (AI)", "Менеджер продукта", "Scrum-мастер", "Senior Technical Program Manager",
                  "Chief Product Officer", "Продакт-менеджер", "Руководитель цифрового продукта", "Владелец продукта"]:
        assert roles.pm_direction(title, "management") == "product", title


def test_other_roles_keep_their_direction():
    for title, direction in [("Продуктовый аналитик", "analytics"), ("Менеджер проектных продаж", "sales"),
                             ("Руководитель проекта в строительстве", "construction"), ("SAP PI PO разработчик", "backend"),
                             ("Старший менеджер по продуктовому маркетингу", "marketing"), ("CTO", "management"),
                             ("Product Manager - Lion Studios", "gamedev")]:
        assert roles.pm_direction(title, direction) == direction, title


def test_outside_it_needs_it_hint():
    assert roles.pm_direction("Менеджер проектов", None, it_context=False) is None
    assert roles.pm_direction("Руководитель IT-проектов", None, it_context=False) == "product"
    assert roles.pm_direction("Product Manager", "finance", it_context=False) == "finance"   # не правим чужие сферы
    assert roles.pm_direction("Product Manager", None, it_context=False) == "product"


def test_telegram_pm_saved_as_product_even_if_ai_says_management():
    store = FakeStore()
    process_post(Post("a", 1, "x" * 50, None, "u"), store, lambda t: job(title="Руководитель проектов", direction="management"))
    assert store.inserted[0]["direction"] == "product"


def test_superjob_pm_outside_it_catalogue_only_with_it_hint():
    base = {"id": 1, "profession": "Руководитель IT-проектов", "link": "u", "date_published": 1792803660,
            "catalogues": [{"key": 11, "title": "Высший менеджмент"}]}
    assert superjob.map_vacancy(base)["direction"] == "product"
    assert superjob.map_vacancy({**base, "profession": "Руководитель проектов"})["direction"] == "management"
    it = {**base, "profession": "Руководитель проектов",
          "catalogues": [{"key": 33, "title": "IT", "positions": [{"key": 630}]}]}
    assert superjob.map_vacancy(it)["direction"] == "product"


def test_trudvsem_pm_in_it_sphere():
    v = {"id": "1", "job-name": "Менеджер проектов", "category": {"specialisation": "Информационные технологии, связь"}}
    assert trudvsem.map_vacancy(v)["direction"] == "product"
    v["category"]["specialisation"] = "Строительство"
    assert trudvsem.map_vacancy(v)["direction"] == "construction"


def test_ats_pm_and_studio_roles():
    board = ats.Board("x", "X", "greenhouse", "x")
    jobs = [{"id": "1", "title": "Technical Program Manager", "url": "u", "location": ""}]
    assert ats.rows_for(board, jobs)[0]["direction"] == "product"
    studio = ats.Board("s", "S", "greenhouse", "s", "gamedev")
    assert ats.rows_for(studio, jobs)[0]["direction"] == "gamedev"


def test_reclassify_pm_updates_only_pm_titles():
    log = []
    rows = [{"id": "a", "title": "Delivery Manager"}, {"id": "b", "title": "Менеджер проектных продаж"}]
    db = type("DB", (), {"table": lambda self, t: FakeQuery(log, data=rows)})()
    assert main.Store(db).reclassify_pm() == 1
    assert ("update", ({"direction": "product"},)) in log and ("in_", ("id", ["a"])) in log
    assert ("in_", ("source_kind", ["telegram", "career"])) in log
