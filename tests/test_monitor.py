"""Проверка доступности: что считается сбоем и когда писать владельцу — без сети."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import requests

import monitor

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)


def fake_get(pages):
    def get(url, timeout=0, headers=None):
        value = pages[url.removeprefix(monitor.SITE)]
        if isinstance(value, Exception):
            raise value
        return SimpleNamespace(status_code=value[0], text=value[1])
    return get


def test_site_problems():
    ok = (200, "<h1>54 000 вакансий</h1>")
    assert monitor.check_site(fake_get({"/": ok, "/jobs": ok}), clock=lambda: 0) == []
    problems = monitor.check_site(fake_get({"/": (500, ""), "/jobs": requests.ConnectionError()}), clock=lambda: 0)
    assert problems == ["/: ответ 500", "/jobs: не открывается (ConnectionError)"]
    assert monitor.check_site(fake_get({"/": (200, "пусто"), "/jobs": ok}), clock=lambda: 0) == [
        "/: страница открылась, но вакансий на ней нет"]


def test_freshness():
    assert monitor.check_freshness(NOW - timedelta(hours=2), NOW) == []
    assert monitor.check_freshness(NOW - timedelta(hours=9), NOW) == ["новых вакансий нет 9 ч — сбор стоит"]


def test_alert_once_then_repeat_and_recovery():
    message, state = monitor.decide(["/: ответ 500"], {}, NOW)
    assert message.startswith("⚠️") and state["down_since"] == NOW.isoformat()
    # через полчаса тот же сбой — молчим
    message, state = monitor.decide(["/: ответ 500"], state, NOW + timedelta(minutes=30))
    assert message is None
    # через 6 часов — напоминание
    message, state = monitor.decide(["/: ответ 500"], state, NOW + timedelta(hours=6))
    assert message is not None
    # сбой изменился — пишем сразу
    message, state = monitor.decide(["/jobs: ответ 502"], state, NOW + timedelta(hours=6, minutes=30))
    assert message is not None and "/jobs" in message
    # всё прошло — одно сообщение о восстановлении
    message, state = monitor.decide([], state, NOW + timedelta(hours=7))
    assert message.startswith("✅") and "420 мин" in message and state == {}
    assert monitor.decide([], state, NOW + timedelta(hours=8)) == (None, {})
