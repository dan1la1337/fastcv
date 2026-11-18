"""Чтение публичных лент Telegram (t.me/s/<канал>): разбор страницы, новые посты, история."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

import requests
from bs4 import BeautifulSoup

# Честный User-Agent, общий со сборщиками сайтов компаний: сайт видит, кто его читает
from careers import USER_AGENT


# Вакансии из Telegram старше стольких дней уходят в архив (main.finish_run)
ARCHIVE_AFTER_DAYS = 30
FIRST_RUN_POSTS = 10  # сколько последних постов брать у нового канала
MAX_PAGES = 5  # сколько страниц истории (~20 постов каждая) листать за запуск
# История канала: при подключении дочитываем посты за последние HISTORY_DAYS дней
# (столько вакансия и живёт в ленте), по HISTORY_PAGES страниц за запуск на канал
HISTORY_DAYS = ARCHIVE_AFTER_DAYS
HISTORY_PAGES = 3


@dataclass
class Post:
    channel: str
    post_id: int
    text: str
    posted_at: Optional[str]  # ISO 8601 из <time datetime>
    url: str

    @property
    def key(self) -> str:
        """Устойчивый идентификатор поста: не меняется, если пост отредактировали."""
        return f"{self.channel}/{self.post_id}"


def parse_channel_page(html: str, channel: str) -> tuple[list[Post], Optional[int]]:
    """Посты со страницы t.me/s/<канал> (по возрастанию id) и id для подгрузки
    более старой истории (параметр ?before=), если он есть."""
    soup = BeautifulSoup(html, "html.parser")
    posts: list[Post] = []
    for msg in soup.select(".tgme_widget_message[data-post]"):
        name, _, number = msg["data-post"].rpartition("/")
        if not number.isdigit():
            continue
        # Текст самого поста, а не процитированного сообщения, на которое он отвечает
        text_el = next(
            (el for el in msg.select(".tgme_widget_message_text")
             if not el.find_parent(class_="tgme_widget_message_reply")),
            None,
        )
        text = text_el.get_text(separator="\n").strip() if text_el else ""
        time_el = msg.select_one(".tgme_widget_message_date time")
        posts.append(Post(
            channel=channel,
            post_id=int(number),
            text=text,
            posted_at=time_el.get("datetime") if time_el else None,
            url=f"https://t.me/{name or channel}/{number}",
        ))
    posts.sort(key=lambda p: p.post_id)

    more = soup.select_one(".tme_messages_more[data-before]")
    before = more["data-before"] if more else None
    return posts, int(before) if before and before.isdigit() else None


class ChannelUnavailable(Exception):
    """Канал не отдаёт публичную ленту (закрыт веб-просмотр, удалён, переименован)."""


def fetch_page(url: str) -> str:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=15)
    resp.raise_for_status()
    # Если у канала закрыт веб-просмотр, Telegram перенаправляет с /s/ на карточку канала
    if "/s/" not in resp.url:
        raise ChannelUnavailable("веб-просмотр канала закрыт")
    return resp.text


def collect_new_posts(
    channel: str,
    last_post_id: Optional[int],
    fetch: Callable[[str], str] = fetch_page,
) -> list[Post]:
    """Посты новее last_post_id по возрастанию id. Для нового канала —
    последние FIRST_RUN_POSTS постов."""
    base = f"https://t.me/s/{channel}"
    posts, before = parse_channel_page(fetch(base), channel)
    if not posts:
        raise ChannelUnavailable("в ленте нет постов")

    if last_post_id is None:
        return posts[-FIRST_RUN_POSTS:]

    pages = 1
    # Листаем назад, пока не дойдём до уже обработанного поста
    while before and posts[0].post_id > last_post_id + 1 and pages < MAX_PAGES:
        older, before = parse_channel_page(fetch(f"{base}?before={before}"), channel)
        if not older:
            break
        posts = older + posts
        pages += 1

    seen: set[int] = set()
    fresh = []
    for p in posts:
        if p.post_id > last_post_id and p.post_id not in seen:
            seen.add(p.post_id)
            fresh.append(p)
    return fresh


def collect_history(
    channel: str,
    before: int,
    fetch: Callable[[str], str] = fetch_page,
    days: int = HISTORY_DAYS,
    max_pages: int = HISTORY_PAGES,
    now: Optional[datetime] = None,
) -> tuple[list[Post], Optional[int]]:
    """Посты старше before за последние days дней, от новых к старым, и курсор
    для следующего запуска: id, с которого продолжать, или None — история дочитана."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    base = f"https://t.me/s/{channel}"
    found: list[Post] = []
    cursor: Optional[int] = before
    for _ in range(max_pages):
        posts, _more = parse_channel_page(fetch(f"{base}?before={cursor}"), channel)
        posts = [p for p in posts if p.post_id < cursor]
        if not posts:
            return found, None
        for p in reversed(posts):
            if p.posted_at and datetime.fromisoformat(p.posted_at) < cutoff:
                return found, None
            found.append(p)
        cursor = posts[0].post_id
        if cursor <= 1:
            return found, None
    return found, cursor


def find_post(channel: str, post_id: int, fetch: Callable[[str], str] = fetch_page) -> Optional[Post]:
    """Текст одного поста: страница ленты, которая заканчивается на нём."""
    posts, _ = parse_channel_page(fetch(f"https://t.me/s/{channel}?before={post_id + 1}"), channel)
    return next((p for p in posts if p.post_id == post_id), None)
