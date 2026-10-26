"""Сброс демо одной командой (план 1.16).

    python demo_reset.py            # вернуть демо-аккаунты в исходное состояние
    python demo_reset.py --check    # только найти аккаунты, ничего не менять

Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
DEMO_CANDIDATE_EMAIL, DEMO_EMPLOYER_EMAIL. Аккаунты заводятся заранее обычной
регистрацией на сайте (кандидат и работодатель); скрипт их не создаёт и паролей не знает.
Что именно сбрасывается — в функции reset_demo (supabase/migrations/20261027050000_demo_reset.sql).
"""
from __future__ import annotations

import json
import os
import sys
from typing import Callable, Iterable


def find_user_ids(list_page: Callable[[int], Iterable], emails: list[str], per_page: int = 200) -> dict[str, str]:
    """id пользователей по адресам почты (без учёта регистра); листает страницы, пока не найдёт всех."""
    wanted = {e.strip().lower() for e in emails}
    found: dict[str, str] = {}
    page = 1
    while wanted - found.keys():
        users = list(list_page(page) or [])
        for user in users:
            email = (getattr(user, "email", None) or "").lower()
            if email in wanted:
                found[email] = str(user.id)
        if len(users) < per_page:
            break
        page += 1
    return found


def main(argv: list[str]) -> int:
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DEMO_CANDIDATE_EMAIL", "DEMO_EMPLOYER_EMAIL")
               if not os.environ.get(k, "").strip()]
    if missing:
        print("Не заданы переменные окружения: " + ", ".join(missing))
        return 2
    from supabase import create_client

    db = create_client(os.environ["SUPABASE_URL"].strip(), os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip())
    candidate = os.environ["DEMO_CANDIDATE_EMAIL"].strip().lower()
    employer = os.environ["DEMO_EMPLOYER_EMAIL"].strip().lower()
    ids = find_user_ids(lambda page: db.auth.admin.list_users(page=page, per_page=200), [candidate, employer])
    for role, email in (("кандидата", candidate), ("работодателя", employer)):
        if email not in ids:
            print(f"Не найден аккаунт {role} {email}: зарегистрируйте его на сайте и запустите снова.")
            return 1
    if "--check" in argv:
        print("Демо-аккаунты найдены, сброс не запускался (--check).")
        return 0
    result = db.rpc("reset_demo", {"candidate": ids[candidate], "employer": ids[employer]}).execute().data
    print("Демо сброшено: " + json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
