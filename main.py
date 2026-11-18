"""FastCV: сборщик вакансий из публичных Telegram-каналов.

Каждый запуск (GitHub Actions, раз в 6 часов):
  1. берёт активные каналы из таблицы channels;
  2. читает публичную ленту канала (t.me/s/<канал>) и выбирает посты новее
     последнего обработанного (channels.last_post_id), листая историю назад,
     если с прошлого запуска вышло больше одной страницы;
  3. прогоняет каждый новый пост через Gemini, который возвращает структуру
     вакансии по JSON-схеме;
  4. сохраняет вакансию со ссылкой на оригинальный пост;
  5. отправляет в архив внешние вакансии старше ARCHIVE_AFTER_DAYS дней;
  6. если что-то пошло не так, пишет владельцу в Telegram (TELEGRAM_BOT_TOKEN,
     TELEGRAM_CHAT_ID); без этих переменных оповещения просто выключены.

Если Gemini недоступен, обработка канала останавливается на этом посте,
и при следующем запуске он будет обработан снова — посты не теряются.

Модули: telegram_feed — чтение лент, ai_client — Gemini, store — Supabase,
bots — Telegram-боты; здесь — обработка постов и точка входа.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Literal, Optional

import requests

# Части сборщика. Некоторые имена main сам не использует: они импортированы, чтобы тесты
# и eval_ai.py по-прежнему находили их в main
from ai_client import (  # noqa: F401
    AI_ATTEMPTS, AI_MODEL_STRIKES, AI_PAUSE_SECONDS, AI_TIMEOUT_MS, GEMINI_MODELS, PROMPT, AIUnavailable, BatchItem,
    VacancyAI, make_gemini_normalizer, wrap_post,
)
from bots import (  # noqa: F401
    TelegramBot, TelegramError, alert_text, daily_report_text, notify, send_digests, send_interview_surveys,
)
from store import Store, channel_week  # noqa: F401
from telegram_feed import (  # noqa: F401
    ARCHIVE_AFTER_DAYS, HISTORY_DAYS, HISTORY_PAGES, MAX_PAGES, ChannelUnavailable, Post, collect_history,
    collect_new_posts, fetch_page, find_post, parse_channel_page,
)


MIN_TEXT_LEN = 40  # короче — точно не вакансия
AI_CIRCUIT_BREAKER = 3  # каналов подряд без ответа Gemini — дальше не пытаемся
# Постов в одном обращении к Gemini: пачка из 10 разбирается за 10–30 с, как один пост,
# поэтому за запуск успеваем в 5–10 раз больше (замер 26.10)
AI_BATCH = 10
AI_PARALLEL = 3   # пачек одновременно; бесплатный лимит — 15 запросов в минуту, мы укладываемся
HISTORY_POSTS_PER_RUN = 800   # новые посты важнее: история — на остаток времени
FETCH_SHARE = 0.5             # доля времени запуска на чтение лент, остальное — ИИ
FETCH_PAUSE_SECONDS = 1
# Чьи истории дочитываем первыми (channels.category): направления, где вакансий меньше всего
HISTORY_FIRST = ("frontend", "qa", "devops", "mobile", "gamedev", "management", "general", "junior", "backend", "product")
CHANNEL_PAUSE_SECONDS = 2
# Время на каналы за один запуск: остальное — «Работа России» и подборки, а у всего
# задания лимит 30 минут. Недошедшие каналы первыми пойдут в следующий запуск.
CHANNELS_TIME_BUDGET_SECONDS = 16 * 60
# Лента не открывается столько запусков подряд (≈3 дня при запуске раз в 2 часа) — канал выключаем
DEAD_AFTER_FAILED_RUNS = 36


_URL = re.compile(r"(https?://|www\.|t\.me/)\S+", re.IGNORECASE)
_MENTION_OR_TAG = re.compile(r"[@#]\w+")
_NOT_WORD = re.compile(r"[\W_]+")


def text_fingerprint(text: str) -> str:
    """Хэш текста без ссылок, @упоминаний, #хэштегов, эмодзи, знаков и регистра.
    Репост вакансии в другом канале обычно отличается только этим."""
    words = _NOT_WORD.sub(" ", _MENTION_OR_TAG.sub(" ", _URL.sub(" ", text.lower()))).split()
    return hashlib.sha256(" ".join(words).encode("utf-8")).hexdigest()


def title_key(title: str) -> str:
    """Как колонка vacancies.title_key: «Android-разработчик» → «android разработчик»."""
    return _NOT_WORD.sub(" ", title.lower()).strip()


def clean_stack(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result = []
    for item in items:
        name = item.strip()
        if name and name.lower() not in seen and len(name) <= 40:
            seen.add(name.lower())
            result.append(name)
    return result[:15]


Outcome = Literal["saved", "duplicate", "not_job", "short"]


@dataclass
class Prepared:
    post: Post
    raw_hash: str
    fingerprint: str


def prepare_post(post: Post, store: Store) -> Outcome | Prepared:
    """Всё, что можно решить без ИИ: короткий пост или уже известный текст."""
    if len(post.text) < MIN_TEXT_LEN:
        return "short"
    raw_hash = hashlib.sha256(post.text.encode("utf-8")).hexdigest()
    fingerprint = text_fingerprint(post.text)
    known = store.is_known(post, raw_hash, fingerprint)
    if known:
        note_sighting(store, known, post)
        return "duplicate"
    return Prepared(post, raw_hash, fingerprint)


def process_post(post: Post, store: Store, normalize: Callable[[str], VacancyAI]) -> Outcome:
    prepared = prepare_post(post, store)
    if not isinstance(prepared, Prepared):
        return prepared
    vacancy = normalize(post.text)  # AIUnavailable пробрасывается наверх
    return save_post(prepared, vacancy, store)


def save_post(prepared: Prepared, vacancy: VacancyAI, store: Store) -> Outcome:
    post, raw_hash, fingerprint = prepared.post, prepared.raw_hash, prepared.fingerprint
    if not vacancy.is_job or not vacancy.title:
        return "not_job"

    title = vacancy.title.strip()[:200]
    company = (vacancy.company or "").strip()[:200] or None
    contact = (vacancy.contact_value or "").lstrip("@") or None
    duplicate = store.find_duplicate(title_key(title), company, contact)
    if duplicate:
        note_sighting(store, duplicate, post)
        return "duplicate"

    saved = store.insert_vacancy({
        "raw_hash": raw_hash,
        "source_post": post.key,
        "source_url": post.url,
        "posted_at": post.posted_at,
        "text_fingerprint": fingerprint,
        "title": title,
        "company_name": company,
        "description": (vacancy.description or "").strip(),
        "salary_min": vacancy.salary_min,
        "salary_max": vacancy.salary_max,
        "salary_currency": vacancy.salary_currency if (vacancy.salary_min or vacancy.salary_max) else None,
        "city": vacancy.city,
        "is_remote": vacancy.is_remote,
        "contact_type": vacancy.contact_type if contact else None,
        "contact_value": contact,
        "stack": clean_stack(vacancy.stack),
        # Пустые значения база заполнит сама (триггер vacancies_normalize), город — приведёт к единому виду
        "level": vacancy.level,
        "direction": vacancy.direction,
        "work_format": vacancy.work_format,
        "hiring_type": vacancy.hiring_type,
        "scope_note": (vacancy.scope_note or "").strip()[:300] or None,
        "experience_min": clean_experience(vacancy.experience_min),
        # Город точнее: база возьмёт страну из него, а ответ ИИ — для вакансий без города
        "country": (vacancy.country or "").strip()[:60] or None,
        "ranking_weight": 1.0,
        "source_type": "external",
    })
    if not saved:
        return "duplicate"
    note_sighting(store, saved, post)
    return "saved"


def clean_experience(years: Optional[float]) -> Optional[float]:
    """Опыт в годах с шагом полгода; явно невозможные значения отбрасываем."""
    if years is None or years < 0 or years > 30:
        return None
    return round(years * 2) / 2


def note_sighting(store: Store, vacancy_id: str, post: Post) -> None:
    """Запись для индекса свежести. Её сбой не должен терять саму вакансию."""
    try:
        store.add_sighting(vacancy_id, post)
    except Exception as e:  # noqa: BLE001 — сеть, права, гонка
        print(f"⚠️ Не удалось отметить публикацию {post.key}: {type(e).__name__}")


@dataclass
class ChannelResult:
    channel: str
    new_posts: int = 0
    saved: int = 0
    error: Optional[str] = None
    ai_stopped: bool = False
    newly_unavailable: bool = False  # лента пропала впервые (раньше читалась)


def process_channel(
    row: dict,
    store: Store,
    normalize: Callable[[str], VacancyAI],
    fetch: Callable[[str], str] = fetch_page,
    pause: Callable[[float], None] = time.sleep,
) -> ChannelResult:
    channel = str(row["username"]).strip().lstrip("@")
    result = ChannelResult(channel)
    now = datetime.now(timezone.utc).isoformat()

    try:
        posts = collect_new_posts(channel, row.get("last_post_id"), fetch)
    except (ChannelUnavailable, requests.RequestException) as e:
        result.error = str(e)
        result.newly_unavailable = not (row.get("failed_runs") or 0)
        store.update_channel(channel, {
            "last_parsed_at": now,
            "last_error": result.error[:300],
            "failed_runs": (row.get("failed_runs") or 0) + 1,
        })
        return result

    result.new_posts = len(posts)
    last_done = row.get("last_post_id")
    for post in posts:
        try:
            outcome = process_post(post, store, normalize)
        except AIUnavailable as e:
            # Не сдвигаем last_post_id: этот и следующие посты обработаем в следующий раз
            result.ai_stopped = True
            result.error = f"Gemini недоступен: {e}"
            break
        if outcome == "saved":
            result.saved += 1
        last_done = post.post_id
        if outcome in ("saved", "not_job"):
            pause(AI_PAUSE_SECONDS)  # пауза только после обращения к Gemini

    store.update_channel(channel, {
        "last_parsed_at": now,
        "last_post_id": last_done,
        "last_error": result.error,
        "failed_runs": 0,
    })
    return result


@dataclass
class RunSummary:
    channels: int
    results: list[ChannelResult]
    archived: int = 0
    out_of_time: bool = False  # каналы отложены по времени — это штатно, не сбой Gemini
    deactivated: list[str] = field(default_factory=list)  # выключенные мёртвые каналы

    @property
    def saved(self) -> int:
        return sum(r.saved for r in self.results)

    @property
    def new_posts(self) -> int:
        return sum(r.new_posts for r in self.results)

    @property
    def deferred(self) -> int:
        """Каналы, до которых не дошли из-за отказа Gemini."""
        return 0 if self.out_of_time else self.channels - len(self.results)

    @property
    def unavailable(self) -> list[ChannelResult]:
        return [r for r in self.results if r.error and not r.ai_stopped]


BACKFILL_CURSOR_KEY = "company_backfill_cursor"


def backfill_companies(
    store: Store,
    normalize: Callable[[str], VacancyAI],
    limit: int,
    fetch: Callable[[str], str] = fetch_page,
    pause: float = 1.0,
) -> tuple[int, int]:
    """Поля «компания» (22.10.2026) и «тип нанимателя» (23.10.2026) есть не у всех вакансий. Берём исходный пост,
    просим ИИ разобрать его ещё раз и записываем только эти два поля, если они пусты.
    У вакансий от старого сборщика нет ссылки на пост — для них разбираем заголовок и описание.
    Идёт от новых к старым; курсор в app_settings, чтобы следующий запуск продолжил дальше,
    а не разбирал заново посты, где компании нет. Возвращает (проверено, заполнено)."""
    cursor = store.get_setting(BACKFILL_CURSOR_KEY)
    rows = store.vacancies_without_company(cursor, limit)
    checked = filled = 0
    for row in rows:
        channel, _, number = (row.get("source_post") or "").rpartition("/")
        text = None
        if channel and number.isdigit():
            try:
                post = find_post(channel, int(number), fetch)
                text = post.text if post else None
            except (requests.RequestException, ChannelUnavailable) as e:
                print(f"⚠️ @{channel}/{number}: пост недоступен ({type(e).__name__})")
            time.sleep(pause)  # бережём Telegram: не чаще запроса в секунду
        if not text:
            text = f"{row.get('title') or ''}\n\n{row.get('description') or ''}".strip()
        if len(text) >= MIN_TEXT_LEN:
            vacancy = normalize(text)  # AIUnavailable пробрасывается: курсор не сдвинется
            company = (vacancy.company or "").strip()[:200]
            if company and not row.get("company_name"):
                store.set_company(row["id"], company)
                filled += 1
            if vacancy.hiring_type and not row.get("hiring_type"):
                store.set_hiring_type(row["id"], vacancy.hiring_type)
            years = clean_experience(vacancy.experience_min)
            if years is not None and row.get("experience_min") is None:
                store.set_experience(row["id"], years, vacancy.level)
        checked += 1
        store.set_setting(BACKFILL_CURSOR_KEY, row["created_at"])
    return checked, filled


def run(store: Store, normalize: Callable[[str], VacancyAI],
        clock: Callable[[], float] = time.monotonic,
        time_budget: float = CHANNELS_TIME_BUDGET_SECONDS) -> RunSummary:
    channels = store.active_channels()
    print(f"Активных каналов: {len(channels)}")
    if hasattr(normalize, "many"):
        return finish_run(store, run_batched(store, normalize, channels, clock=clock, time_budget=time_budget))
    results = []
    ai_failures_in_row = 0
    started = clock()
    out_of_time = False
    for row in channels:
        if clock() - started > time_budget:
            out_of_time = True
            print(f"⏱ Время на каналы вышло — остальные ({len(channels) - len(results)}) "
                  f"первыми пойдут в следующий запуск.")
            break
        if ai_failures_in_row >= AI_CIRCUIT_BREAKER:
            # Gemini лежит: остальные каналы не трогаем, их last_post_id не меняется,
            # и следующий запуск продолжит с того же места
            print(f"⏸ Gemini недоступен на {AI_CIRCUIT_BREAKER} каналах подряд — "
                  f"остальные каналы ({len(channels) - len(results)}) отложены до следующего запуска.")
            break
        r = process_channel(row, store, normalize)
        status = f"⚠️ {r.error}" if r.error else "ok"
        print(f"📡 @{r.channel}: новых постов {r.new_posts}, сохранено {r.saved} — {status}")
        results.append(r)
        ai_failures_in_row = ai_failures_in_row + 1 if r.ai_stopped else 0
        time.sleep(CHANNEL_PAUSE_SECONDS)

    return finish_run(store, RunSummary(len(channels), results, out_of_time=out_of_time))


def finish_run(store: Store, summary: RunSummary) -> RunSummary:
    results = summary.results
    summary.deactivated = store.deactivate_dead_channels(DEAD_AFTER_FAILED_RUNS)
    if summary.deactivated:
        print(f"Выключены каналы без ленты {DEAD_AFTER_FAILED_RUNS} запусков подряд: {', '.join(summary.deactivated)}")
    summary.archived = archived = store.archive_stale(ARCHIVE_AFTER_DAYS)
    total_saved = sum(r.saved for r in results)
    unavailable = [r.channel for r in results if r.error and not r.ai_stopped]
    print(f"\nИтого: новых вакансий {total_saved}, в архив отправлено {archived}.")
    if unavailable:
        print(f"Каналы без доступной ленты ({len(unavailable)}): {', '.join('@' + c for c in unavailable)}")
    if any(r.ai_stopped for r in results):
        print("Часть постов отложена до следующего запуска: Gemini был недоступен.")
    return summary


@dataclass
class ChannelWork:
    row: dict
    result: ChannelResult
    new: list[Post] = field(default_factory=list)        # по возрастанию id
    history: list[Post] = field(default_factory=list)    # от новых к старым
    history_next: Optional[int] = None                   # курсор истории после этого запуска
    history_started: bool = False
    done: dict[int, Outcome] = field(default_factory=dict)


def run_batched(store: Store, normalize, channels: list[dict],
                clock: Callable[[], float] = time.monotonic,
                time_budget: float = CHANNELS_TIME_BUDGET_SECONDS,
                fetch: Callable[[str], str] = fetch_page,
                pause: Callable[[float], None] = time.sleep) -> RunSummary:
    """Сначала читаем ленты всех каналов, потом разбираем новые посты пачками по AI_BATCH
    через одно обращение к Gemini, на остаток времени — историю каналов за HISTORY_DAYS дней.
    Канал запоминает последний пост, до которого всё разобрано: недоделанное — в следующий раз."""
    started = clock()
    works: list[ChannelWork] = []
    out_of_time = False
    history_quota = HISTORY_POSTS_PER_RUN

    for row in channels:
        if clock() - started > time_budget * FETCH_SHARE:
            out_of_time = True
            break
        channel = str(row["username"]).strip().lstrip("@")
        work = ChannelWork(row, ChannelResult(channel))
        works.append(work)
        try:
            work.new = collect_new_posts(channel, row.get("last_post_id"), fetch)
        except (ChannelUnavailable, requests.RequestException) as e:
            work.result.error = str(e)
            work.result.newly_unavailable = not (row.get("failed_runs") or 0)
            continue
        work.result.new_posts = len(work.new)
        pause(FETCH_PAUSE_SECONDS)

    # История: сначала каналы направлений, где вакансий меньше всего (HISTORY_FIRST)
    order = {c: i for i, c in enumerate(HISTORY_FIRST)}
    for work in sorted(works, key=lambda w: order.get(w.row.get("category") or "", len(order))):
        if work.result.error:
            continue
        row, channel = work.row, work.result.channel
        cursor = row.get("history_before")
        if cursor is None:   # история не начата: идём назад от самого старого из известных постов
            cursor = work.new[0].post_id if work.new else (row.get("last_post_id") or 0) + 1
        if cursor and cursor > 1 and history_quota > 0 and clock() - started <= time_budget * FETCH_SHARE:
            work.history_started = True
            try:
                work.history, work.history_next = collect_history(channel, cursor, fetch)
            except (ChannelUnavailable, requests.RequestException):
                work.history, work.history_next = [], cursor
            work.history = work.history[:history_quota]
            if work.history and len(work.history) == history_quota:
                work.history_next = work.history[-1].post_id
            history_quota -= len(work.history)
            pause(FETCH_PAUSE_SECONDS)
        elif cursor:
            work.history_next = cursor

    # Без ИИ: короткие и уже известные посты
    pending: list[tuple[ChannelWork, Prepared]] = []
    for work in works:
        for post in work.new + work.history:
            prepared = prepare_post(post, store)
            if isinstance(prepared, Prepared):
                pending.append((work, prepared))
            else:
                work.done[post.post_id] = prepared
    # Сначала новые посты всех каналов, потом история
    pending.sort(key=lambda wp: wp[1].post not in wp[0].new)

    ai_stopped: Optional[str] = None
    failed_in_row = 0
    chunks = [pending[i:i + AI_BATCH] for i in range(0, len(pending), AI_BATCH)]
    # Пачки уходят в Gemini по AI_PARALLEL одновременно: ответ на пачку ~15 с, и почти всё это
    # время — ожидание модели. Пачку, на которую Gemini так и не ответил (повторы с паузой
    # внутри normalize.many), пропускаем: её посты останутся необработанными и пойдут в
    # следующий запуск. После AI_CIRCUIT_BREAKER неудачных пачек подряд останавливаемся.
    with ThreadPoolExecutor(max_workers=AI_PARALLEL) as pool:
        for w in range(0, len(chunks), AI_PARALLEL):
            if clock() - started > time_budget:
                out_of_time = True
                break
            if failed_in_row >= AI_CIRCUIT_BREAKER:
                print(f"⏸ Gemini не ответил на {failed_in_row} пачек подряд — остальное в следующий запуск.")
                break
            wave = chunks[w:w + AI_PARALLEL]
            futures = [pool.submit(normalize.many, [p.post.text for _, p in chunk]) for chunk in wave]
            for chunk, future in zip(wave, futures):
                try:
                    vacancies = future.result()
                except Exception as e:  # noqa: BLE001 — AIUnavailable или непойманный сбой клиента
                    ai_stopped = f"Gemini недоступен: {e}" if isinstance(e, AIUnavailable) \
                        else f"Gemini недоступен: {type(e).__name__}"
                    failed_in_row += 1
                    print(f"⚠️ Пачка из {len(chunk)} постов пропущена: {ai_stopped}")
                    continue
                failed_in_row = 0
                for (work, prepared), vacancy in zip(chunk, vacancies):
                    outcome = save_post(prepared, vacancy, store)
                    work.done[prepared.post.post_id] = outcome
                    if outcome == "saved":
                        work.result.saved += 1
            pause(AI_PAUSE_SECONDS)

    now = datetime.now(timezone.utc).isoformat()
    for work in works:
        r, row = work.result, work.row
        if r.error:
            store.update_channel(r.channel, {
                "last_parsed_at": now, "last_error": r.error[:300],
                "failed_runs": (row.get("failed_runs") or 0) + 1,
            })
            continue
        last_done = row.get("last_post_id")
        finished = True
        for post in work.new:
            if post.post_id not in work.done:
                finished = False
                break
            last_done = post.post_id
        history_next = work.history_next
        for post in work.history:
            if post.post_id not in work.done:
                history_next = post.post_id + 1   # продолжим с этого поста
                break
        if not finished and ai_stopped:
            r.ai_stopped, r.error = True, ai_stopped
        fields = {"last_post_id": last_done, "last_error": r.error, "failed_runs": 0,
                  # 0 — история дочитана; канал без новых постов не трогаем
                  "history_before": history_next if history_next is not None else (0 if work.history_started else row.get("history_before"))}
        if finished:
            fields["last_parsed_at"] = now   # недоделанные каналы первыми пойдут в следующий запуск
        store.update_channel(r.channel, fields)

    results = [w.result for w in works]
    for r in results:
        status = f"⚠️ {r.error}" if r.error else "ok"
        print(f"📡 @{r.channel}: новых постов {r.new_posts}, сохранено {r.saved} — {status}")
    history_total = sum(len(w.history) for w in works)
    print(f"История каналов: {history_total} постов за {HISTORY_DAYS} дней, к ИИ — {len(pending)} постов всего.")
    if out_of_time:
        print("⏱ Время вышло — недоделанное первым пойдёт в следующий запуск.")
    summary = RunSummary(len(channels), results, out_of_time=out_of_time or (not ai_stopped and len(works) < len(channels)))
    return summary


def env(*names: str) -> str | None:
    """Первое непустое значение из переменных окружения, без пробелов и переносов
    по краям: лишний символ из копипаста ломает HTTP-заголовок и сервер рвёт соединение."""
    for name in names:
        value = (os.getenv(name) or "").strip()
        if value:
            return value
    return None


def describe_key(key: str) -> str:
    """Тип ключа без раскрытия значения — для диагностики в логах."""
    if key.startswith("sb_secret_"):
        return "secret (sb_secret_)"
    if key.startswith("sb_publishable_"):
        return "publishable (sb_publishable_)"
    if key.count(".") == 2:
        return "legacy JWT"
    return "неизвестный формат"


def fail(message: str) -> None:
    notify(f"❌ FastCV: сборщик не запустился\n\n{message}")
    sys.exit(message)


def main() -> None:
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv(".env.local")
    load_dotenv(".env")

    supabase_url = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
    gemini_key = env("GEMINI_API_KEY")
    # Сборщику нужен service-role ключ: запись в vacancies и channels для
    # публичного ключа закрыта правилами доступа (supabase/migrations).
    supabase_key = env("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_key:
        supabase_key = env("SUPABASE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")
        if supabase_key:
            print("⚠️ SUPABASE_SERVICE_ROLE_KEY не задан, используется запасной ключ — "
                  "с публичным ключом запись в базу не пройдёт.")

    if not supabase_url or not supabase_key:
        fail("Не найдены ключи Supabase! Проверьте .env или .env.local")
    if not gemini_key:
        fail("Не найден GEMINI_API_KEY! Проверьте .env или .env.local")

    print(f"Ключ Supabase: {describe_key(supabase_key)}, длина {len(supabase_key)}")
    if not supabase_key.isascii() or any(c.isspace() for c in supabase_key):
        fail(
            "Ключ Supabase содержит недопустимые символы (например «•» или пробелы). "
            "Похоже, скопирован замаскированный ключ с экрана: в Supabase → Project Settings → "
            "API Keys нажмите кнопку копирования у ключа и обновите секрет SUPABASE_SERVICE_ROLE_KEY."
        )

    if (os.getenv("ALERT_TEST") or "").lower() == "true":
        sent = notify("✅ FastCV: оповещения сборщика работают. Сюда придёт сообщение, если сбор вакансий "
                      "сломается, и каждое утро — сводка за сутки. Пример сводки ниже.")
        if not sent:
            sys.exit("Тестовое сообщение не отправлено: проверьте секреты TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID "
                     "и что вы нажали Start у своего бота.")
        notify(daily_report_text(Store(create_client(supabase_url, supabase_key)).daily_stats()))
        return

    print("==================== ЗАПУСК СБОРА ====================")
    models = tuple(m.strip() for m in (env("GEMINI_MODELS") or "").split(",") if m.strip()) or GEMINI_MODELS
    print(f"Модели Gemini: {', '.join(models)}")
    try:
        store = Store(create_client(supabase_url, supabase_key))
        channel_normalizer = make_gemini_normalizer(gemini_key, models)
        summary = run(store, channel_normalizer)
    except Exception as e:
        # Текст ошибки без значений ключей: они в заголовках запросов, а не в сообщении
        notify(f"❌ FastCV: сборщик упал\n\n{type(e).__name__}: {str(e)[:500]}")
        raise
    text = alert_text(summary)
    if text:
        notify(text)
    # Итоги каналов и Gemini — в базу (логи Actions не всегда доступны): видно, упирается ли
    # сбор в лимит Gemini (ошибки 429) или во время
    try:
        store.set_setting("channels_last_run", json.dumps({
            "at": datetime.now(timezone.utc).isoformat(),
            "channels": summary.channels, "processed": len(summary.results),
            "posts": sum(r.new_posts for r in summary.results), "saved": sum(r.saved for r in summary.results),
            "out_of_time": summary.out_of_time, "ai": getattr(channel_normalizer, "stats", None),
        }, ensure_ascii=False))
    except Exception as e:
        print(f"⚠️ Итоги каналов не сохранены: {type(e).__name__}")
    # Подборки кандидатам — отдельным ботом. Чаты к нему привязывает сайт (webhook),
    # бот оповещений владельца (TELEGRAM_BOT_TOKEN) с кандидатами не общается.
    jobs_token = env("TELEGRAM_JOBS_BOT_TOKEN")
    if jobs_token:
        try:
            sent = send_digests(store, TelegramBot(jobs_token))
            print(f"Telegram: отправлено подборок {sent}")
        except Exception as e:  # подписка не должна ронять сбор
            print(f"⚠️ Подборки в Telegram: {type(e).__name__}: {str(e)[:200]}")
        try:
            surveys = send_interview_surveys(store, TelegramBot(jobs_token))
            print(f"Telegram: опросов о собеседованиях {surveys}")
        except Exception as e:
            print(f"⚠️ Опросы о собеседованиях: {type(e).__name__}: {str(e)[:200]}")
    # ИИ-выжимка отзывов о найме для страниц компаний (рейтинг работодателя)
    if gemini_key:
        try:
            import reviews
            print(f"Отзывы о найме: {reviews.run(store.db, reviews.make_writer(gemini_key))}")
        except Exception as e:  # выжимка не должна ронять сбор
            print(f"⚠️ Выжимка отзывов: {type(e).__name__}: {str(e)[:200]}")
    # Непрочитанные сообщения в чате — письмом и в Telegram-бот (кому он подключён)
    resend_key = env("RESEND_API_KEY")
    if resend_key or jobs_token:
        try:
            import notifications
            chat = notifications.send_chat_notifications(
                store, notifications.make_sender(resend_key) if resend_key else None,
                TelegramBot(jobs_token).send if jobs_token else None)
            print(f"Уведомления о сообщениях: {chat}")
        except Exception as e:
            print(f"⚠️ Уведомления о сообщениях: {type(e).__name__}")
        # Напоминания о собеседованиях накануне — обеим сторонам
        try:
            import notifications
            reminders = notifications.send_interview_reminders(
                store, notifications.make_sender(resend_key) if resend_key else None,
                TelegramBot(jobs_token).send if jobs_token else None)
            print(f"Напоминания о собеседованиях: {reminders}")
        except Exception as e:
            print(f"⚠️ Напоминания о собеседованиях: {type(e).__name__}")
    # Письма об откликах: работодателям — о новых, кандидатам — о приглашении или отказе
    if resend_key:
        try:
            import notifications
            print(f"Письма об откликах: {notifications.send_notifications(store, notifications.make_sender(resend_key))}")
        except Exception as e:  # письма не должны ронять сбор; текст ошибки может содержать ключ
            print(f"⚠️ Письма об откликах: {type(e).__name__}")
    # Сайты компаний (карты сайтов): JobPosting или разбор страницы тем же ИИ. CAREERS=off — выключить
    if (env("CAREERS") or "on").lower() != "off":
        try:
            import careers
            fetcher = careers.Fetcher()
            fetcher.use_russian_ca()
            # Каждый запуск начинаем со следующей компании: если время кончится, очередь дойдёт до всех
            offset = int(store.get_setting("careers_offset") or 0) % len(careers.COMPANIES)
            store.set_setting("careers_offset", str(offset + 1))
            order = careers.COMPANIES[offset:] + careers.COMPANIES[:offset]
            career_stats = careers.import_careers(store, make_gemini_normalizer(gemini_key, models), fetcher, order)
            print(f"Сайты компаний: {career_stats}")
            # Итоги по компаниям — в базу: логи Actions не всегда под рукой, а так видно в /admin и SQL
            store.set_setting("careers_last_run", json.dumps(
                {"at": datetime.now(timezone.utc).isoformat(), "companies": career_stats}, ensure_ascii=False))
        except Exception as e:
            print(f"⚠️ Сайты компаний: {type(e).__name__}: {str(e)[:200]}")
        # Открытые API систем найма (Greenhouse, Workable): игровые студии и JetBrains
        try:
            import ats
            ats_stats = ats.run(store)
            print(f"Системы найма: {ats_stats}")
            store.set_setting("ats_last_run", json.dumps(
                {"at": datetime.now(timezone.utc).isoformat(), "boards": ats_stats}, ensure_ascii=False))
        except Exception as e:
            print(f"⚠️ Системы найма: {type(e).__name__}: {str(e)[:200]}")
    # «Работа России»: открытые данные без ИИ. Отключается переменной TRUDVSEM=off
    if (env("TRUDVSEM") or "on").lower() != "off":
        try:
            from trudvsem import import_trudvsem
            print(f"Работа России: {import_trudvsem(store)}")
        except Exception as e:  # импорт не должен ронять сбор из Telegram
            print(f"⚠️ Работа России: {type(e).__name__}: {str(e)[:200]}")
    # SuperJob: официальный API, ключ приложения — секрет SUPERJOB_API_KEY
    superjob_key = env("SUPERJOB_API_KEY")
    if superjob_key:
        try:
            import superjob
            print(f"SuperJob: {superjob.run(store, superjob_key)}")
        except Exception as e:  # ошибку не печатаем целиком: в ней может оказаться запрос с ключом
            print(f"⚠️ SuperJob: {type(e).__name__}")
    backfill = min(int(float(env("BACKFILL_COMPANY") or 0)), 600)
    if backfill > 0:
        try:
            checked, filled = backfill_companies(store, make_gemini_normalizer(gemini_key, models), backfill)
            print(f"Компании: проверено вакансий {checked}, заполнено {filled}")
        except Exception as e:  # дозаполнение не должно ронять успешный сбор
            print(f"⚠️ Дозаполнение компаний остановлено: {type(e).__name__}: {str(e)[:200]}")
    if (os.getenv("DAILY_REPORT") or "").lower() == "true":
        try:
            notify(daily_report_text(store.daily_stats(), summary))
        except Exception as e:  # сводка не должна ронять успешный сбор
            print(f"⚠️ Не удалось собрать сводку: {type(e).__name__}: {str(e)[:200]}")
    print("==================== ЦИКЛ ЗАВЕРШЁН ====================")


if __name__ == "__main__":
    main()
