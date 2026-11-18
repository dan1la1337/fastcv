"""Telegram-боты: оповещения владельцу (сбои, сводка за сутки) и подборки кандидатам."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Callable, Optional

import requests

if TYPE_CHECKING:
    from main import RunSummary
    from store import Store


# Доля каналов без доступной ленты, при которой это похоже на блокировку, а не на закрытые каналы
MASS_FAILURE_SHARE = 0.5


def alert_text(summary: RunSummary) -> Optional[str]:
    """Текст оповещения владельцу или None, если запуск прошёл штатно."""
    problems = []
    ai_stopped = [r for r in summary.results if r.ai_stopped]
    if ai_stopped or summary.deferred:
        problems.append(
            f"Gemini не отвечал: обработка остановлена на {len(ai_stopped)} канал(ах)"
            + (f", ещё {summary.deferred} отложено" if summary.deferred else "")
            + ". Посты не потеряны, следующий запуск продолжит с того же места."
        )
    unavailable = summary.unavailable
    if summary.results and len(unavailable) >= max(2, len(summary.results) * MASS_FAILURE_SHARE):
        problems.append(
            f"Лента недоступна у {len(unavailable)} из {len(summary.results)} каналов. "
            "Похоже, Telegram ограничил доступ или поменял разметку страницы."
        )
    else:
        fresh = [r.channel for r in unavailable if r.newly_unavailable]
        if fresh:
            problems.append(
                "Перестала открываться лента: " + ", ".join("@" + c for c in fresh)
                + ". Канал закрыли или удалили; если так и останется, его стоит отключить."
            )
    if summary.channels and summary.results and not summary.new_posts and not unavailable:
        problems.append("Ни одного нового поста во всех каналах. Возможно, сломался разбор страницы Telegram.")
    if summary.deactivated:
        problems.append("Выключены каналы, лента которых не открывается ~3 дня: "
                        + ", ".join("@" + c for c in summary.deactivated) + ". Включить обратно — is_active в таблице channels (Supabase).")
    if not problems:
        return None
    lines = ["⚠️ FastCV: проблемы со сборщиком", ""]
    lines += [f"• {p}" for p in problems]
    lines += ["", f"Итог запуска: каналов {len(summary.results)}/{summary.channels}, "
                  f"новых постов {summary.new_posts}, вакансий сохранено {summary.saved}."]
    return "\n".join(lines)


def daily_report_text(stats: dict, summary: Optional[RunSummary] = None) -> str:
    """Сводка за сутки для владельца: что прибавилось и всё ли в порядке с источниками."""
    unavailable = stats["unavailable_channels"]
    lines = [
        "📊 FastCV: сводка за сутки",
        "",
        f"Новых вакансий: из Telegram {stats['vacancies_external']}, от работодателей {stats['vacancies_employer']}, "
        f"«Работа России» {stats.get('vacancies_trudvsem', 0)}, SuperJob {stats.get('vacancies_superjob', 0)}, "
        f"сайты компаний {stats.get('vacancies_career', 0)}",
        f"Всего в ленте: {stats['vacancies_in_feed']}",
        f"Новых пользователей: {stats['users']}",
        f"Откликов: {stats['applications']}",
        f"Каналов: {stats['channels']}, лента не открывается у {len(unavailable)}"
        + (": " + ", ".join("@" + c for c in unavailable[:10]) + (" и др." if len(unavailable) > 10 else "")
           if unavailable else ""),
    ]
    week = stats.get("channel_week") or {}
    if week:
        top = sorted(((n, c) for c, n in week.items() if n), reverse=True)[:5]
        silent = sorted(c for c, n in week.items() if not n)
        if top:
            lines.append("Лучшие каналы за неделю: " + ", ".join(f"@{c} {n}" for n, c in top))
        if silent:
            lines.append(f"Без вакансий за неделю ({len(silent)}): " + ", ".join("@" + c for c in silent[:10])
                         + (" и др." if len(silent) > 10 else "") + " — кандидаты на замену")
    if summary is not None:
        lines.append(f"Последний запуск: новых постов {summary.new_posts}, сохранено {summary.saved}"
                     + (", были проблемы (сообщение выше)" if alert_text(summary) else ", без проблем"))
    return "\n".join(lines)


def run_link() -> Optional[str]:
    """Ссылка на текущий запуск в GitHub Actions (в оповещении — чтобы сразу открыть лог)."""
    server, repo, run_id = (os.getenv(k) for k in ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"))
    return f"{server}/{repo}/actions/runs/{run_id}" if server and repo and run_id else None


def notify(text: str, post: Callable[..., object] = requests.post) -> bool:
    """Отправляет сообщение в Telegram. Ошибка оповещения не должна ронять сборщик."""
    token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    chat_id = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()
    if not token or not chat_id:
        return False
    link = run_link()
    if link:
        text = f"{text}\n\nЛог: {link}"
    try:
        response = post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True},
            timeout=15,
        )
        ok = getattr(response, "ok", False)
        if not ok:
            # Тело ответа без токена: Telegram объясняет причину (например, «chat not found»)
            print(f"⚠️ Telegram не принял оповещение: {getattr(response, 'text', '')[:200]}")
        return bool(ok)
    except requests.RequestException as e:
        print(f"⚠️ Не удалось отправить оповещение в Telegram: {type(e).__name__}")
        return False


SITE_URL = "https://fastcv.ru"
DIGEST_MIN_SCORE = 70  # не меньше этого совпадения — иначе рассылка превращается в спам


class TelegramBot:
    """Минимальный клиент Bot API. Токен — из секретов, в логи не попадает."""

    def __init__(self, token: str, post: Callable[..., object] = requests.post):
        self.token, self.post = token, post

    def call(self, method: str, payload: dict) -> dict:
        response = self.post(f"https://api.telegram.org/bot{self.token}/{method}", json=payload, timeout=20)
        try:
            body = response.json()  # type: ignore[attr-defined]
        except ValueError:
            body = {}
        if not body.get("ok"):
            raise TelegramError(int(body.get("error_code") or 0), str(body.get("description") or "")[:200])
        return body.get("result")

    def send(self, chat_id: int, text: str, buttons: Optional[list[list[dict]]] = None) -> None:
        payload: dict = {"chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True}
        if buttons:
            payload["reply_markup"] = {"inline_keyboard": buttons}
        self.call("sendMessage", payload)


class TelegramError(Exception):
    def __init__(self, code: int, description: str):
        super().__init__(f"{code} {description}")
        self.code = code


def digest_text(items: list[dict]) -> str:
    lines = ["🔎 Новые вакансии для вас", ""]
    for item in items:
        company = f" — {item['company']}" if item.get("company") else ""
        lines.append(f"• {item['title']}{company} · совпадение {item['score']}%")
        lines.append(f"{SITE_URL}/vacancy/{item['id']}")
    lines += ["", f"Все подходящие: {SITE_URL}/?tab=for-you"]
    return "\n".join(lines)


def send_digests(store: Store, bot: TelegramBot) -> int:
    sent = 0
    for row in store.telegram_digest(DIGEST_MIN_SCORE):
        try:
            bot.send(row["chat_id"], digest_text(row["items"]))
            store.mark_digest_sent(row["user_id"])
            sent += 1
        except TelegramError as e:
            if e.code == 403:  # бот заблокирован пользователем
                store.stop_notifications(row["chat_id"])
            print(f"⚠️ Подборка не доставлена: {e}")
    return sent


def survey_message(row: dict, token: str) -> tuple[str, list[list[dict]]]:
    """Опрос через 2 дня после приглашения: оценка собеседования 1–5 (план 1.13, слой 2).
    Кнопки — ссылки на сайт с секретом опроса: так не нужен отдельный режим вебхука."""
    company = f" в «{row['company']}»" if row.get("company") else ""
    text = (f"Как прошло собеседование{company} на «{row['title']}»?\n\n"
            "Оцените от 1 до 5 — анонимно. Из оценок кандидатов складывается рейтинг работодателя на FastCV.")
    buttons = [[{"text": f"{n} ⭐", "url": f"{SITE_URL}/feedback/{token}?r={n}"} for n in range(1, 6)]]
    return text, buttons


def send_interview_surveys(store: Store, bot: TelegramBot) -> int:
    sent = 0
    for row in store.interview_surveys_due():
        try:
            token = store.start_interview_survey(row["application_id"])
            text, buttons = survey_message(row, token)
            bot.send(row["chat_id"], text, buttons)
            sent += 1
        except TelegramError as e:
            if e.code == 403:
                store.stop_notifications(row["chat_id"])
            print(f"⚠️ Опрос о собеседовании не доставлен: {e}")
    return sent
