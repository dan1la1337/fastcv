"""Работа с Supabase: каналы, вакансии, настройки, RPC для рассылок."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from telegram_feed import Post


DUPLICATE_DAYS = 21  # в этом окне та же должность той же компании — дубль из другого канала
# Источники без ИИ, которые тоже source_type = external (source_post = «источник/id»)
IMPORTED_SOURCES = ("trudvsem", "superjob", "career")


def _like_escape(value: str) -> str:
    """Точное сравнение без учёта регистра через ilike: % и _ — не шаблоны."""
    return re.sub(r"([%_\\])", r"\\\1", value)


def _quoted(value: str) -> str:
    """Значение в двойных кавычках для фильтра PostgREST (запятые и скобки внутри безопасны)."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


class Store:
    """Работа с Supabase. Вынесено отдельно, чтобы тесты подменяли базу."""

    def __init__(self, client):
        self.db = client

    def active_channels(self) -> list[dict]:
        return (self.db.table("channels")
                .select("username, category, last_post_id, failed_runs, history_before")
                .eq("is_active", True)
                # Сначала каналы, которые дольше всего не проверялись: если предохранитель
                # Gemini прервёт прогон, в следующий раз очередь дойдёт до остальных
                .order("last_parsed_at", nullsfirst=True).order("username")
                .execute().data)

    def is_known(self, post: Post, raw_hash: str, fingerprint: str) -> Optional[str]:
        """id уже сохранённой вакансии с этим постом или тем же текстом, иначе None."""
        rows = (self.db.table("vacancies").select("id")
                .or_(f'source_post.eq."{post.key}",raw_hash.eq.{raw_hash},text_fingerprint.eq.{fingerprint}')
                .limit(1).execute().data)
        return rows[0]["id"] if rows else None

    def find_duplicate(self, key: str, company: Optional[str], contact: Optional[str]) -> Optional[str]:
        """Та же должность у той же компании или с тем же контактом за последние DUPLICATE_DAYS:
        одну вакансию часто публикуют в нескольких каналах разным текстом."""
        conditions = []
        if company:
            conditions.append(f"company_name.ilike.{_quoted(_like_escape(company))}")
        if contact:
            conditions.append(f"contact_value.ilike.{_quoted(_like_escape(contact))}")
        if not key or not conditions:
            return None
        since = (datetime.now(timezone.utc) - timedelta(days=DUPLICATE_DAYS)).isoformat()
        rows = (self.db.table("vacancies").select("id")
                .is_("archived_at", "null").eq("title_key", key).gte("created_at", since)
                .or_(",".join(conditions)).limit(1).execute().data)
        return rows[0]["id"] if rows else None

    def insert_vacancy(self, payload: dict) -> Optional[str]:
        """id новой вакансии; None, если такая уже есть (гонка или повторный пост)."""
        try:
            rows = self.db.table("vacancies").insert(payload).execute().data
            return rows[0]["id"] if rows else None
        except Exception as e:  # postgrest.APIError
            if getattr(e, "code", None) == "23505":
                return None
            raise

    def add_sighting(self, vacancy_id: str, post: Post) -> None:
        """Отметить, что вакансия появилась в этом посте (индекс свежести). Повтор — без ошибки."""
        self.db.table("vacancy_sightings").upsert(
            {"source_post": post.key, "vacancy_id": vacancy_id, "channel": post.channel, "posted_at": post.posted_at},
            on_conflict="source_post", ignore_duplicates=True,
        ).execute()

    def update_channel(self, username: str, fields: dict) -> None:
        self.db.table("channels").update(fields).eq("username", username).execute()

    def count(self, table: str, **filters) -> int:
        """Число строк без их загрузки. filters: gte_<колонка>, eq_<колонка>, is_<колонка>."""
        query = self.db.table(table).select("*", count="exact", head=True)
        for key, value in filters.items():
            op, column = key.split("_", 1)
            query = getattr(query, "is_" if op == "is" else op)(column, value)
        return int(query.execute().count or 0)

    def telegram_vacancies(self, columns: str = "source_post", **select_options):
        """Вакансии из Telegram: внешние, но не из API «Работы России» и SuperJob."""
        query = self.db.table("vacancies").select(columns, **select_options).eq("source_type", "external")
        for source in IMPORTED_SOURCES:
            query = query.filter("source_post", "not.like", f"{source}/%")
        return query

    def imported_since(self, source: str, since: str) -> int:
        return (self.db.table("vacancies").select("id", count="exact", head=True)
                .like("source_post", f"{source}/%").gte("created_at", since).execute().count or 0)

    def deactivate_dead_channels(self, failed_runs: int) -> list[str]:
        """Каналы, чья лента не открывается много запусков подряд, — выключить (вернуть можно в /admin)."""
        rows = (self.db.table("channels").select("username")
                .eq("is_active", True).gte("failed_runs", failed_runs).execute().data)
        names = [r["username"] for r in rows]
        if names:
            self.db.table("channels").update({"is_active": False}).in_("username", names).execute()
        return names

    def daily_stats(self) -> dict:
        since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        unavailable = (self.db.table("channels").select("username")
                       .eq("is_active", True).gt("failed_runs", 0).order("username")
                       .execute().data)
        active = [r["username"] for r in self.db.table("channels").select("username").eq("is_active", True).execute().data]
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        # Только посты из Telegram: «Работа России» и SuperJob — десятки тысяч строк в сутки,
        # с ними лимит выборки заполнялся целиком и все каналы выглядели «без вакансий»
        week_posts = (self.telegram_vacancies().select("source_post").gte("created_at", week_ago).limit(5000)
                      .execute().data)
        return {
            "channel_week": channel_week(active, [r["source_post"] for r in week_posts]),
            "vacancies_external": self.telegram_vacancies("id", count="exact", head=True).gte("created_at", since).execute().count or 0,
            "vacancies_trudvsem": self.imported_since("trudvsem", since),
            "vacancies_superjob": self.imported_since("superjob", since),
            "vacancies_career": self.imported_since("career", since),
            "vacancies_employer": self.count("vacancies", gte_created_at=since, eq_source_type="internal"),
            "vacancies_in_feed": self.count("vacancies", is_archived_at="null"),
            "users": self.count("profiles", gte_created_at=since),
            "applications": self.count("applications", gte_created_at=since),
            "channels": self.count("channels", eq_is_active=True),
            "unavailable_channels": [r["username"] for r in unavailable],
        }

    # --- подписка кандидатов в Telegram ---------------------------------------

    def get_setting(self, key: str) -> Optional[str]:
        rows = self.db.table("app_settings").select("value").eq("key", key).limit(1).execute().data
        return rows[0]["value"] if rows else None

    def set_setting(self, key: str, value: str) -> None:
        self.db.table("app_settings").upsert({"key": key, "value": value,
                                               "updated_at": datetime.now(timezone.utc).isoformat()}).execute()

    def telegram_digest(self, min_score: int) -> list[dict]:
        return self.db.rpc("telegram_digest", {"min_score": min_score}).execute().data or []

    def mark_digest_sent(self, user_id: str) -> None:
        # Отдельное имя: ниже есть mark_notified для писем, одноимённый метод перекрывал этот
        self.db.table("profiles").update({"telegram_notified_at": datetime.now(timezone.utc).isoformat()}).eq("id", user_id).execute()

    def interview_surveys_due(self) -> list[dict]:
        return self.db.rpc("interview_surveys_due", {}).execute().data or []

    def start_interview_survey(self, application_id: str) -> str:
        return str(self.db.rpc("start_interview_survey", {"application": application_id}).execute().data)

    def stop_notifications(self, chat_id: int) -> None:
        """Пользователь заблокировал бота — больше ему не пишем."""
        self.db.table("profiles").update({"telegram_notify": False, "telegram_chat_id": None}).eq("telegram_chat_id", chat_id).execute()

    def archive_stale(self, days: int) -> int:
        result = self.db.rpc("archive_stale_vacancies", {"days": days}).execute()
        return int(result.data or 0)

    def vacancies_without_company(self, before: Optional[str], limit: int) -> list[dict]:
        """Активные вакансии из Telegram без компании или типа нанимателя, от новых к старым
        (до курсора before)."""
        q = (self.db.table("vacancies")
             .select("id, source_post, title, description, company_name, hiring_type, experience_min, created_at")
             .is_("archived_at", "null").eq("source_type", "external")
             .or_("company_name.is.null,hiring_type.is.null,experience_min.is.null"))
        if before:
            q = q.lt("created_at", before)
        return q.order("created_at", desc=True).limit(limit).execute().data or []

    def set_company(self, vacancy_id: str, company: str) -> None:
        self.db.table("vacancies").update({"company_name": company}).eq("id", vacancy_id).is_("company_name", "null").execute()

    def set_experience(self, vacancy_id: str, years: float, level: Optional[str]) -> None:
        """Опыт из текста и грейд, определённый по нему (шкала: до 2 лет / 2–5 / от 5)."""
        fields: dict = {"experience_min": years}
        if level:
            fields["level"] = level
        self.db.table("vacancies").update(fields).eq("id", vacancy_id).is_("experience_min", "null").execute()

    def count_trudvsem(self) -> int:
        return (self.db.table("vacancies").select("id", count="exact", head=True)
                .like("source_post", "trudvsem/%").execute().count or 0)

    def upsert_trudvsem(self, rows: list[dict]) -> int:
        """Новые вакансии «Работы России» добавляются, изменённые — обновляются по source_post."""
        self.db.table("vacancies").upsert(rows, on_conflict="source_post").execute()
        return len(rows)

    def prune_trudvsem(self, keep_days: int) -> dict:
        return self.db.rpc("prune_trudvsem", {"keep_days": keep_days}).execute().data or {}

    def count_source(self, source: str) -> int:
        return (self.db.table("vacancies").select("id", count="exact", head=True)
                .like("source_post", f"{source}/%").execute().count or 0)

    def upsert_imported(self, rows: list[dict]) -> int:
        """Вакансии из API без ИИ (SuperJob): новые добавляются, известные обновляются по source_post."""
        self.db.table("vacancies").upsert(rows, on_conflict="source_post").execute()
        return len(rows)

    def prune_superjob_closed(self, open_ids: list[str], since: datetime) -> int:
        return self.db.rpc("prune_superjob_closed", {"open_ids": open_ids, "since": since.isoformat()}).execute().data or 0

    def prune_source(self, source: str, keep_hours: int) -> dict:
        return self.db.rpc("prune_imported", {"source": source, "keep_hours": keep_hours}).execute().data or {}

    def career_ids(self, company: str) -> dict[str, bool]:
        """Вакансии компании с её сайта: id → в архиве ли (постранично: их тысячи)."""
        prefix, found, start = f"career/{company}/", {}, 0
        while True:
            rows = (self.db.table("vacancies").select("source_post, archived_at")
                    .like("source_post", prefix + "%").order("source_post").range(start, start + 999)
                    .execute().data)
            for r in rows:
                found[r["source_post"][len(prefix):]] = r["archived_at"] is not None
            if len(rows) < 1000:
                return found
            start += 1000

    def career_weak_descriptions(self, company: str, limit: int) -> list[tuple[str, str]]:
        """Активные вакансии компании с пустым или шаблонным описанием: (source_post, адрес)."""
        from careers import TEMPLATE_PHRASES
        # Значения в кавычках: в фразах бывают запятые («Белая зарплата, ДМС»), а запятая
        # в фильтре or= разделяет условия — без кавычек PostgREST отвечает ошибкой
        weak = ",".join(["description.is.null"] + [f'description.ilike."*{p}*"' for p in TEMPLATE_PHRASES])
        rows = (self.db.table("vacancies").select("source_post, source_url")
                .like("source_post", f"career/{company}/%").is_("archived_at", "null")
                .or_(weak).not_.is_("source_url", "null")
                .order("created_at", desc=True).limit(limit).execute().data or [])
        return [(r["source_post"], r["source_url"]) for r in rows]

    def update_description(self, source_post: str, description: str) -> None:
        self.db.table("vacancies").update({"description": description}).eq("source_post", source_post).execute()

    def archive_career(self, company: str, ids: list[str]) -> int:
        now = datetime.now(timezone.utc).isoformat()
        for i in range(0, len(ids), 200):
            posts = [f"career/{company}/{vid}" for vid in ids[i:i + 200]]
            self.db.table("vacancies").update({"archived_at": now}).in_("source_post", posts).execute()
        return len(ids)

    def pending_chat_notifications(self) -> list[dict]:
        return self.db.rpc("pending_chat_notifications", {}).execute().data or []

    def mark_chat_notified(self, conversation_id: str, side: str) -> None:
        self.db.rpc("mark_chat_notified", {"conversation": conversation_id, "side": side}).execute()

    def pending_interview_reminders(self) -> list[dict]:
        return self.db.rpc("pending_interview_reminders", {}).execute().data or []

    def mark_interview_reminded(self, slot_id: str) -> None:
        self.db.rpc("mark_interview_reminded", {"slot": slot_id}).execute()

    def pending_notifications(self) -> list[dict]:
        return self.db.rpc("pending_notifications", {}).execute().data or []

    def mark_notified(self, kind: str, ids: list[str]) -> int:
        return self.db.rpc("mark_notified", {"kind": kind, "ids": ids}).execute().data or 0

    def set_hiring_type(self, vacancy_id: str, hiring_type: str) -> None:
        self.db.table("vacancies").update({"hiring_type": hiring_type}).eq("id", vacancy_id).is_("hiring_type", "null").execute()


def channel_week(active: list[str], source_posts: list[Optional[str]]) -> dict[str, int]:
    """Сколько вакансий за неделю дал каждый активный канал (source_post = «канал/id поста»)."""
    counts = {name.lower(): 0 for name in active}
    names = {name.lower(): name for name in active}
    for post in source_posts:
        channel = (post or "").split("/", 1)[0].lower()
        if channel in counts:
            counts[channel] += 1
    return {names[c]: n for c, n in counts.items()}
