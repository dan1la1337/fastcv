"""Проверка доступности fastcv.ru и свежести данных (план, 1.6).

Каждые полчаса из GitHub Actions: открывается ли сайт и лента, не встал ли сбор
(новых вакансий нет дольше FRESH_HOURS). О сбое — в Telegram владельцу, о восстановлении —
тоже; пока сбой длится, напоминаем не чаще раза в REPEAT_HOURS. Состояние — в app_settings.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

import requests

SITE = "https://fastcv.ru"
PAGES = ("/", "/jobs")
SLOW_SECONDS = 8.0
FRESH_HOURS = 6         # сборщик ходит каждые 2 часа: 6 часов без новых вакансий — сбор стоит
REPEAT_HOURS = 6
STATE_KEY = "monitor_state"


def check_site(get: Callable[..., requests.Response] = requests.get,
               clock: Callable[[], float] = time.monotonic) -> list[str]:
    """Проблемы сайта: недоступен, ошибка, слишком медленно, пустая лента."""
    problems = []
    for path in PAGES:
        started = clock()
        try:
            response = get(SITE + path, timeout=20, headers={"User-Agent": "FastCV-monitor/1.0"})
        except requests.RequestException as e:
            problems.append(f"{path}: не открывается ({type(e).__name__})")
            continue
        seconds = clock() - started
        if response.status_code != 200:
            problems.append(f"{path}: ответ {response.status_code}")
        elif "ваканси" not in response.text.lower():
            problems.append(f"{path}: страница открылась, но вакансий на ней нет")
        elif seconds > SLOW_SECONDS:
            problems.append(f"{path}: открывается {seconds:.0f} с")
    return problems


def check_freshness(latest: Optional[datetime], now: datetime) -> list[str]:
    if latest is None:
        return ["в базе нет вакансий"]
    hours = (now - latest).total_seconds() / 3600
    return [f"новых вакансий нет {hours:.0f} ч — сбор стоит"] if hours > FRESH_HOURS else []


def decide(problems: list[str], state: dict, now: datetime) -> tuple[Optional[str], dict]:
    """Что отправить владельцу и новое состояние. Сбой — сразу и раз в REPEAT_HOURS; конец сбоя — один раз."""
    if not problems:
        if state.get("down_since"):
            since = datetime.fromisoformat(state["down_since"])
            minutes = int((now - since).total_seconds() // 60)
            return f"✅ FastCV снова в порядке (сбой длился ~{minutes} мин).", {}
        return None, {}
    last = state.get("alerted_at")
    new_state = {"down_since": state.get("down_since") or now.isoformat(), "alerted_at": last}
    changed = sorted(problems) != sorted(state.get("problems", []))
    if last is None or changed or now - datetime.fromisoformat(last) >= timedelta(hours=REPEAT_HOURS):
        new_state["alerted_at"] = now.isoformat()
        new_state["problems"] = problems
        return "⚠️ FastCV: проблема\n\n" + "\n".join(f"• {p}" for p in problems), new_state
    new_state["problems"] = state.get("problems", problems)
    return None, new_state


def main() -> None:
    from main import Store, notify
    from supabase import create_client

    store = Store(create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]))
    now = datetime.now(timezone.utc)
    problems = check_site()
    try:
        rows = (store.db.table("vacancies").select("created_at")
                .order("created_at", desc=True).limit(1).execute().data)
        latest = datetime.fromisoformat(rows[0]["created_at"]) if rows else None
        problems += check_freshness(latest, now)
    except Exception as e:  # база не отвечает — это тоже сбой
        problems.append(f"база не отвечает ({type(e).__name__})")
    try:
        state = json.loads(store.get_setting(STATE_KEY) or "{}")
    except Exception:
        state = {}
    message, new_state = decide(problems, state, now)
    print("Проблемы:", problems or "нет")
    if message:
        notify(message)
    try:
        store.set_setting(STATE_KEY, json.dumps(new_state, ensure_ascii=False))
    except Exception as e:
        print(f"⚠️ Состояние не сохранено: {type(e).__name__}")


if __name__ == "__main__":
    main()
