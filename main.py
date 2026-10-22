"""FastCV: сборщик вакансий из публичных Telegram-каналов.

Каждый запуск (GitHub Actions, раз в 6 часов):
  1. берёт активные каналы из таблицы channels;
  2. читает публичную ленту канала (t.me/s/<канал>) и выбирает посты новее
     последнего обработанного (channels.last_post_id), листая историю назад,
     если с прошлого запуска вышло больше одной страницы;
  3. прогоняет каждый новый пост через Gemini, который возвращает структуру
     вакансии по JSON-схеме;
  4. сохраняет вакансию со ссылкой на оригинальный пост;
  5. отправляет в архив внешние вакансии старше ARCHIVE_AFTER_DAYS дней.

Если Gemini недоступен, обработка канала останавливается на этом посте,
и при следующем запуске он будет обработан снова — посты не теряются.
"""

from __future__ import annotations

import hashlib
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Literal, Optional

import requests
from bs4 import BeautifulSoup
from pydantic import BaseModel

ARCHIVE_AFTER_DAYS = 30
FIRST_RUN_POSTS = 10  # сколько последних постов брать у нового канала
MAX_PAGES = 5  # сколько страниц истории (~20 постов каждая) листать за запуск
MIN_TEXT_LEN = 40  # короче — точно не вакансия
# Модели по очереди: если одна перегружена (503) или упёрлась в лимит (429),
# запрос уходит в следующую. Переопределяется переменной GEMINI_MODELS.
GEMINI_MODELS = ("gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash")
AI_ATTEMPTS = 2  # попыток на каждую модель
AI_TIMEOUT_MS = 60_000  # без таймаута зависший запрос держал весь прогон
AI_CIRCUIT_BREAKER = 3  # каналов подряд без ответа Gemini — дальше не пытаемся
AI_PAUSE_SECONDS = 2
CHANNEL_PAUSE_SECONDS = 2
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"


# ---------------------------------------------------------------------------
# Разбор ленты Telegram
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Нормализация через Gemini
# ---------------------------------------------------------------------------


Currency = Literal["RUB", "USD", "EUR", "KZT", "BYN", "UAH", "UZS", "GEL", "AMD", "TRY", "AED", "RSD", "PLN"]


class VacancyAI(BaseModel):
    """Ответ Gemini. Все поля обязательны, но могут быть null: так модель
    всегда возвращает полную структуру, а схема не зависит от значений по умолчанию."""

    is_job: bool
    title: Optional[str]
    company: Optional[str]
    description: Optional[str]
    salary_min: Optional[int]
    salary_max: Optional[int]
    salary_currency: Optional[Currency]
    city: Optional[str]
    is_remote: bool
    contact_type: Optional[Literal["telegram", "email"]]
    contact_value: Optional[str]
    stack: list[str]


PROMPT = """Ты нормализатор вакансий для доски объявлений о работе.
Определи, является ли текст поста вакансией (предложением работы от работодателя).
Резюме соискателей, реклама курсов, новости и подборки статей — не вакансии.

Если это вакансия, заполни поля:
- title: название должности, коротко;
- company: название компании-работодателя, если оно есть в тексте, иначе null
  (не путай с названием канала или кадрового агентства, если оно не нанимает само);
- description: 2–3 предложения о требованиях, обязанностях и условиях, по-русски;
- salary_min / salary_max: числа в месяц в валюте поста, если указаны, иначе null;
  «$5k» = 5000, «300к» = 300000; если указана почасовая или годовая ставка — пересчитай в месяц;
- salary_currency: ISO-код валюты зарплаты (RUB, USD, EUR, KZT…); если зарплата есть,
  а валюта не указана — RUB для постов на русском; null, если зарплаты нет;
- city: город, если указан, иначе null;
- is_remote: true, если можно работать удалённо;
- contact_type и contact_value: "telegram" и username без @, либо "email" и адрес;
  если контакта нет или это только ссылка на сайт — оба null;
- stack: ключевые технологии и инструменты из текста (Python, React, PostgreSQL, Figma…),
  без общих слов вроде «опыт» или «английский»; пустой список, если их нет.
Если это не вакансия, верни is_job=false, остальные поля null, stack пустой.

Текст поста:
"""


class AIUnavailable(Exception):
    """Gemini не ответил после всех попыток (перегрузка, лимит, сбой сети)."""


def make_gemini_normalizer(api_key: str, models: tuple[str, ...] = GEMINI_MODELS) -> Callable[[str], VacancyAI]:
    import httpx
    from google import genai
    from google.genai import errors, types

    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=AI_TIMEOUT_MS))
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=VacancyAI,
        temperature=0,
    )

    def normalize(text: str) -> VacancyAI:
        failures: list[str] = []
        for model in models:
            for attempt in range(AI_ATTEMPTS):
                try:
                    response = client.models.generate_content(model=model, contents=PROMPT + text, config=config)
                    if isinstance(response.parsed, VacancyAI):
                        return response.parsed
                    return VacancyAI.model_validate_json(response.text)
                except errors.APIError as e:
                    if e.code == 404:  # модели нет (сняли с поддержки) — сразу к следующей
                        failures.append(f"{model}: 404")
                        break
                    if e.code != 429 and not (e.code and e.code >= 500):
                        # 400 и подобные — ошибка в запросе, другие модели не помогут
                        raise AIUnavailable(f"{model}: {e.code} {e.status}") from e
                    failures.append(f"{model}: {e.code}")
                except (httpx.HTTPError, requests.RequestException, ValueError) as e:
                    failures.append(f"{model}: {type(e).__name__}")
                if attempt + 1 < AI_ATTEMPTS:
                    time.sleep(AI_PAUSE_SECONDS * 2 ** attempt)
        raise AIUnavailable("; ".join(failures[-3:]) or "нет ответа")

    return normalize


def clean_stack(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result = []
    for item in items:
        name = item.strip()
        if name and name.lower() not in seen and len(name) <= 40:
            seen.add(name.lower())
            result.append(name)
    return result[:15]


# ---------------------------------------------------------------------------
# Хранилище
# ---------------------------------------------------------------------------


class Store:
    """Работа с Supabase. Вынесено отдельно, чтобы тесты подменяли базу."""

    def __init__(self, client):
        self.db = client

    def active_channels(self) -> list[dict]:
        return (self.db.table("channels")
                .select("username, last_post_id, failed_runs")
                .eq("is_active", True).order("username").execute().data)

    def is_known(self, post: Post, raw_hash: str) -> bool:
        rows = (self.db.table("vacancies").select("id")
                .or_(f'source_post.eq."{post.key}",raw_hash.eq.{raw_hash}')
                .limit(1).execute().data)
        return bool(rows)

    def insert_vacancy(self, payload: dict) -> bool:
        """False, если такая вакансия уже есть (гонка или повторный пост)."""
        try:
            self.db.table("vacancies").insert(payload).execute()
            return True
        except Exception as e:  # postgrest.APIError
            if getattr(e, "code", None) == "23505":
                return False
            raise

    def update_channel(self, username: str, fields: dict) -> None:
        self.db.table("channels").update(fields).eq("username", username).execute()

    def archive_stale(self, days: int) -> int:
        result = self.db.rpc("archive_stale_vacancies", {"days": days}).execute()
        return int(result.data or 0)


# ---------------------------------------------------------------------------
# Обработка
# ---------------------------------------------------------------------------

Outcome = Literal["saved", "duplicate", "not_job", "short"]


def process_post(post: Post, store: Store, normalize: Callable[[str], VacancyAI]) -> Outcome:
    if len(post.text) < MIN_TEXT_LEN:
        return "short"

    raw_hash = hashlib.sha256(post.text.encode("utf-8")).hexdigest()
    if store.is_known(post, raw_hash):
        return "duplicate"

    vacancy = normalize(post.text)  # AIUnavailable пробрасывается наверх
    if not vacancy.is_job or not vacancy.title:
        return "not_job"

    saved = store.insert_vacancy({
        "raw_hash": raw_hash,
        "source_post": post.key,
        "source_url": post.url,
        "posted_at": post.posted_at,
        "title": vacancy.title.strip()[:200],
        "company_name": (vacancy.company or "").strip()[:200] or None,
        "description": (vacancy.description or "").strip(),
        "salary_min": vacancy.salary_min,
        "salary_max": vacancy.salary_max,
        "salary_currency": vacancy.salary_currency if (vacancy.salary_min or vacancy.salary_max) else None,
        "city": vacancy.city,
        "is_remote": vacancy.is_remote,
        "contact_type": vacancy.contact_type if vacancy.contact_value else None,
        "contact_value": (vacancy.contact_value or "").lstrip("@") or None,
        "stack": clean_stack(vacancy.stack),
        "ranking_weight": 1.0,
        "source_type": "external",
    })
    return "saved" if saved else "duplicate"


@dataclass
class ChannelResult:
    channel: str
    new_posts: int = 0
    saved: int = 0
    error: Optional[str] = None
    ai_stopped: bool = False


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


def run(store: Store, normalize: Callable[[str], VacancyAI]) -> list[ChannelResult]:
    channels = store.active_channels()
    print(f"Активных каналов: {len(channels)}")
    results = []
    ai_failures_in_row = 0
    for row in channels:
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

    archived = store.archive_stale(ARCHIVE_AFTER_DAYS)
    total_saved = sum(r.saved for r in results)
    unavailable = [r.channel for r in results if r.error and not r.ai_stopped]
    print(f"\nИтого: новых вакансий {total_saved}, в архив отправлено {archived}.")
    if unavailable:
        print(f"Каналы без доступной ленты ({len(unavailable)}): {', '.join('@' + c for c in unavailable)}")
    if any(r.ai_stopped for r in results):
        print("Часть постов отложена до следующего запуска: Gemini был недоступен.")
    return results


# ---------------------------------------------------------------------------
# Запуск
# ---------------------------------------------------------------------------


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


def main() -> None:
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv(".env.local")
    load_dotenv(".env")

    supabase_url = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
    gemini_key = env("GEMINI_API_KEY")
    # Сборщику нужен service-role ключ: запись в vacancies и channels для
    # публичного ключа закрыта правилами доступа (supabase/schema.sql).
    supabase_key = env("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_key:
        supabase_key = env("SUPABASE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")
        if supabase_key:
            print("⚠️ SUPABASE_SERVICE_ROLE_KEY не задан, используется запасной ключ — "
                  "с публичным ключом запись в базу не пройдёт.")

    if not supabase_url or not supabase_key:
        sys.exit("Не найдены ключи Supabase! Проверьте .env или .env.local")
    if not gemini_key:
        sys.exit("Не найден GEMINI_API_KEY! Проверьте .env или .env.local")

    print(f"Ключ Supabase: {describe_key(supabase_key)}, длина {len(supabase_key)}")
    if not supabase_key.isascii() or any(c.isspace() for c in supabase_key):
        sys.exit(
            "Ключ Supabase содержит недопустимые символы (например «•» или пробелы). "
            "Похоже, скопирован замаскированный ключ с экрана: в Supabase → Project Settings → "
            "API Keys нажмите кнопку копирования у ключа и обновите секрет SUPABASE_SERVICE_ROLE_KEY."
        )

    print("==================== ЗАПУСК СБОРА ====================")
    models = tuple(m.strip() for m in (env("GEMINI_MODELS") or "").split(",") if m.strip()) or GEMINI_MODELS
    print(f"Модели Gemini: {', '.join(models)}")
    run(Store(create_client(supabase_url, supabase_key)), make_gemini_normalizer(gemini_key, models))
    print("==================== ЦИКЛ ЗАВЕРШЁН ====================")


if __name__ == "__main__":
    main()
