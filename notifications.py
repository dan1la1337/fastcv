"""Письма об откликах через Resend (ключ — секрет RESEND_API_KEY). Запускается сборщиком
раз в 2 часа: работодателю — сводка новых откликов одним письмом и напоминание об
откликах без ответа дольше недели, кандидату — письмо, когда его пригласили на
собеседование или отказали. Очередь и отметки — в базе
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


def reminder_email(rows: list[dict]) -> dict:
    """Anti-ghosting: отклики, на которые работодатель не ответил неделю."""
    total = len(rows)
    items = "".join(f"<li>{html.escape(r.get('candidate_name') or 'Кандидат')} — {html.escape(r['vacancy_title'])}</li>"
                    for r in rows[:20])
    more = f"<p>…и ещё {total - 20}.</p>" if total > 20 else ""
    body = (f"<p>{total} {plural(total, ('кандидат ждёт', 'кандидата ждут', 'кандидатов ждут'))} ответа больше недели:</p>"
            f"<ul>{items}</ul>{more}"
            "<p>Даже короткий отказ помогает кандидату и поднимает доверие к вашей компании. "
            f'Ответить можно в один клик: <a href="{SITE}/employer">открыть отклики</a>.</p>')
    return {"subject": f"{total} {plural(total, ('отклик ждёт', 'отклика ждут', 'откликов ждут'))} вашего ответа",
            "html": _page("Кандидаты ждут ответа", body)}


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
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)   # (вид, адрес) → отклики
    candidate = []
    for row in queue:
        if not row.get("email"):
            continue
        (candidate.append(row) if row["kind"] == "candidate_status" else grouped[(row["kind"], row["email"])].append(row))

    letters = {"employer_new": employer_email, "employer_reminder": reminder_email}
    for (kind, email), rows in grouped.items():
        if sent >= MAX_PER_RUN or kind not in letters:
            continue
        try:
            send(email, letters[kind](rows))
        except requests.RequestException:
            failed += 1      # отметку не ставим — попробуем в следующий запуск
            continue
        store.mark_notified(kind, [r["application_id"] for r in rows])
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


def chat_text(row: dict) -> str:
    n = row["unread"]
    return (f"💬 {n} {plural(n, ('новое сообщение', 'новых сообщения', 'новых сообщений'))} от {row['other_name']} "
            f"по вакансии «{row['vacancy_title']}».\n\nОтветить: {SITE}/messages?c={row['conversation_id']}")


def chat_email(row: dict) -> dict:
    n = row["unread"]
    who, title = html.escape(row["other_name"]), html.escape(row["vacancy_title"])
    body = (f"<p>{who} {plural(n, ('написал', 'написал', 'написал'))} вам в чате по вакансии «{title}»: "
            f"{n} {plural(n, ('непрочитанное сообщение', 'непрочитанных сообщения', 'непрочитанных сообщений'))}.</p>"
            f'<p><a href="{SITE}/messages?c={row["conversation_id"]}">Открыть чат</a></p>')
    return {"subject": f"Новое сообщение от {row['other_name']}: {row['vacancy_title']}",
            "html": _page("Новое сообщение", body)}


def send_chat_notifications(store, send_email: Callable[[str, dict], None] | None,
                            send_telegram: Callable[[int, str], None] | None) -> dict:
    """О непрочитанных сообщениях — в Telegram, если бот подключён, иначе письмом.
    Отметку ставим, если ушло хоть одним способом: иначе напомним в следующий запуск."""
    sent = failed = 0
    for row in store.pending_chat_notifications():
        delivered = False
        if send_telegram and row.get("telegram_chat_id"):
            try:
                send_telegram(row["telegram_chat_id"], chat_text(row))
                delivered = True
            except Exception:
                failed += 1
        if not delivered and send_email and row.get("email") and sent < MAX_PER_RUN:
            try:
                send_email(row["email"], chat_email(row))
                delivered = True
            except requests.RequestException:
                failed += 1
        if delivered:
            store.mark_chat_notified(row["conversation_id"], row["side"])
            sent += 1
    return {"sent": sent, "failed": failed}


def interview_text(row: dict) -> str:
    place = f"\nГде: {row['place']}" if row.get("place") else ""
    return (f"⏰ Напоминание: собеседование {row['when_label']} ({row['duration_min']} мин) — "
            f"{row['other_name']}, «{row['vacancy_title']}».{place}\n\n"
            f"Чат: {SITE}/messages?c={row['conversation_id']}")


def interview_email(row: dict) -> dict:
    who, title = html.escape(row["other_name"]), html.escape(row["vacancy_title"])
    place = f"<p>Где: {html.escape(row['place'])}</p>" if row.get("place") else ""
    body = (f"<p>Напоминаем: собеседование <b>{html.escape(row['when_label'])}</b>, {row['duration_min']} мин.</p>"
            f"<p>{who} · «{title}»</p>{place}"
            f'<p><a href="{SITE}/messages?c={row["conversation_id"]}">Открыть чат</a> — там можно перенести или отменить встречу.</p>')
    return {"subject": f"Собеседование {row['when_label']}: {row['vacancy_title']}",
            "html": _page("Напоминание о собеседовании", body)}


def send_interview_reminders(store, send_email: Callable[[str, dict], None] | None,
                             send_telegram: Callable[[int, str], None] | None) -> dict:
    """Накануне собеседования — обеим сторонам (Telegram, иначе письмо). Отметку на запись
    ставим, только если дошло хотя бы одному: иначе повторим в следующий запуск."""
    sent = failed = 0
    by_slot: dict[str, list[dict]] = defaultdict(list)
    for row in store.pending_interview_reminders():
        by_slot[row["slot_id"]].append(row)
    for slot_id, rows in by_slot.items():
        delivered = False
        for row in rows:
            if send_telegram and row.get("telegram_chat_id"):
                try:
                    send_telegram(row["telegram_chat_id"], interview_text(row))
                    delivered = True
                    sent += 1
                    continue
                except Exception:
                    failed += 1
            if send_email and row.get("email") and sent < MAX_PER_RUN:
                try:
                    send_email(row["email"], interview_email(row))
                    delivered = True
                    sent += 1
                except requests.RequestException:
                    failed += 1
        if delivered:
            store.mark_interview_reminded(slot_id)
    return {"sent": sent, "failed": failed}
