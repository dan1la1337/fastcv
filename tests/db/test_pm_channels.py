"""Каналы с вакансиями менеджеров продукта и проектов подключены миграцией."""

from __future__ import annotations

from test_rls import database, psql  # noqa: F401  (фикстура database: чистая база со всеми миграциями)


def test_pm_channels_are_added(database):  # noqa: F811
    ok, out = psql("select string_agg(username || ':' || category, ',') from channels "
                   "where username in ('product_work', 'productvacancy', 'jobs_pm')")
    # Порядок строк в string_agg зависит от сортировки базы: сравниваем множества
    assert ok and set(out.split(",")) == {"jobs_pm:product", "product_work:product", "productvacancy:product"}, out
