"""Письма об откликах через Resend (ключ — секрет RESEND_API_KEY). Запускается сборщиком
раз в 2 часа: работодателю — сводка новых откликов одним письмом, кандидату — письмо,
когда его пригласили на собеседование или отказали. Очередь и отметки — в базе
(pending_notifications / mark_notified), так что письмо не уйдёт дважды.
"""

from __future__ import annotations

import html
from collections import defaultdict
from typing import Callable

import requests

API = "https://api.resend.com/emails"
SENDER = "FastCV <noreply@fastcv.ru>"
SITE = "https://fastcv.ru"
MAX_PER_RUN = 100       # с запасом под лимит Resend на бесплатном тарифе (100 писем в сутки)


def plural(n: int, forms: tuple[str, str, str]) -> str:
    n100, n10 = n % 100, n % 10
    return forms[2] if 11 <= n100 <= 14 else forms[0] if n10 == 1 else forms[1] if 2 <= n10 <= 4 else forms[2]


def _page(title: str, body: str) -> str:
    return (f'<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">'
            f'<h2 style="margin:0 0 12px">{title}</h2>{body}'
            f'<p style="color:#888;font-size:12px;margin-top:24px">FastCV · {SITE.removeprefix("https://")}</p></div>')


def employer_email(rows: list[dict]) -> dict:
    """Сводка для одного работодателя: по каждой вакансии — сколько новых откликов."""
    by_vacancy: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_vacancy[r["vacancy_title"]].append(r)
    total = len(rows)
    items = "".join(f"<li>{html.escape(title)} — {len(apps)} {plural(len(apps), ('отклик', 'отклика', 'откликов'))}</li>"
                    for title, apps in sorted(by_vacancy.items()))
    body = (f"<p>На ваши вакансии пришло {total} {plural(total, ('новый отклик', 'новых отклика', 'новых откликов'))}:</p>"
            f"<ul>{items}</ul>"
            f'<p><a href="{SITE}/employer">Открыть отклики</a> — кандидаты отсортированы по совпадению с вакансией.</p>')
    return {"subject": f"{total} {plural(total, ('новый отклик', 'новых отклика', 'новых откликов'))} на FastCV",
            "html": _page("Новые отклики", body)}


def candidate_email(row: dict) -> dict:
    title = html.escape(row["vacancy_title"] or "вакансия")
    company = f" в {html.escape(row['company'])}" if row.get("company") else ""
    message = (f'<p style="background:#f4f4f5;padding:12px;border-radius:8px">{html.escape(row["hr_message"])}</p>'
               if row.get("hr_message") else "")
    if row["status"] == "interview_scheduled":
        subject = f"Вас пригласили на собеседование: {row['vacancy_title']}"
        body = f"<p>Работодатель пригласил вас на собеседование по вакансии «{title}»{company}.</p>{message}"
    else:
        subject = f"Ответ по вакансии: {row['vacancy_title']}"
        body = (f"<p>По вакансии «{title}»{company} работодатель ответил отказом.</p>{message}"
                "<p>Не расстраивайтесь — в ленте каждый день новые вакансии.</p>")
    body += f'<p><a href="{SITE}/applications">Мои отклики</a></p>'
    return {"subject": subject, "html": _page("Ответ работодателя", body)}


def make_sender(api_key: str, post: Callable[..., requests.Response] = requests.post) -> Callable[[str, dict], None]:
    def send(to: str, mail: dict) -> None:
        response = post(API, json={"from": SENDER, "to": [to], **mail},
                        headers={"Authorization": f"Bearer {api_key}"}, timeout=20)
        response.raise_for_status()
    return send


def send_notifications(store, send: Callable[[str, dict], None]) -> dict:
    queue = store.pending_notifications()
    sent = failed = 0
    employer: dict[str, list[dict]] = defaultdict(list)
    candidate = []
    for row in queue:
        if not row.get("email"):
            continue
        (employer[row["email"]].append(row) if row["kind"] == "employer_new" else candidate.append(row))

    for email, rows in employer.items():
        if sent >= MAX_PER_RUN:
            break
        try:
            send(email, employer_email(rows))
        except requests.RequestException:
            failed += 1      # отметку не ставим — попробуем в следующий запуск
            continue
        store.mark_notified("employer_new", [r["application_id"] for r in rows])
        sent += 1

    for row in candidate:
        if sent >= MAX_PER_RUN:
            break
        try:
            send(row["email"], candidate_email(row))
        except requests.RequestException:
            failed += 1
            continue
        store.mark_notified("candidate_status", [row["application_id"]])
        sent += 1
    return {"sent": sent, "failed": failed, "queued": len(queue)}
