"""Обезличивание постов перед отправкой в Gemini (серверы в США).

Телефоны, ники и ссылки t.me, email и имена рекрутёров заменяются метками
вида [контакт1]. Метки обратимы: таблица «метка → исходное значение» остаётся у нас,
и после ответа модели метки в полях вакансии заменяются обратно. Так модель
по-прежнему выбирает контакт для отклика (contact_value), но самих данных не видит.

Шаблоны телефона и ника — те же, что в src/lib/redact.ts на сайте.
"""

from __future__ import annotations

import re
from typing import Optional

# +7 (999) 123-45-67, 8 999 123 45 67, +44 20 7946 0958. Зарплаты («150 000 – 200 000»)
# не подходят: нужен + или 8/7 в начале и 10–11 цифр с разделителями
PHONE = re.compile(r"(?:\+\d{1,3}|(?<!\d)[78])[\s\-–.()]*\d{3}[\s\-–.()]*\d{3}[\s\-–.]*\d{2}[\s\-–.]*\d{2,4}(?!\d)")
EMAIL = re.compile(r"[\w.%+-]+@[\w.-]+\.[^\W\d_]{2,}")
# Ссылка на профиль в Telegram (t.me/hr_anna); ссылки на посты (t.me/канал/123) и
# приглашения (t.me/+abc) не трогаем
TG_LINK = re.compile(r"(?:https?://)?(?:t\.me|telegram\.me)/([A-Za-z][A-Za-z0-9_]{3,31})(?![\w/])", re.IGNORECASE)
HANDLE = re.compile(r"(?<![\w@.\-])@([A-Za-z][A-Za-z0-9_]{3,31})\b")
# Имя после слов, за которыми в вакансиях обычно стоит рекрутёр: «HR: Анна Петрова»,
# «пишите Марии», «контактное лицо — Ольга»
# Только кириллица: латиница после «пишите» — чаще технологии и грейды («Senior Python»)
_NAME_CUE = (r"(?:рекрут[её]р\w*|hr(?:[\s-]*менеджер\w*)?|менеджер\w* по подбору|контактное лицо|"
             r"контакт\w*|пишите|писать|обращаться(?: к)?|звоните)")
_NAME_WORD = r"[А-ЯЁ][а-яё]{1,20}"
NAME = re.compile(rf"(?i:\b{_NAME_CUE})\s*[:—–-]?\s*({_NAME_WORD}(?:\s+{_NAME_WORD})?)\b")
# Слова с заглавной буквы после «пишите», которые не имена
_NOT_NAMES = {"телеграм", "телеграмм", "телеграме", "вотсап", "ватсап", "почта", "почту", "тг", "нам", "сюда",
              "здесь", "ссылка", "резюме", "директ", "личку", "лс"}

_CONTACT = re.compile("|".join(f"(?P<{name}>{rx.pattern})" for name, rx in
                               (("email", EMAIL), ("link", TG_LINK), ("handle", HANDLE), ("phone", PHONE))),
                      re.IGNORECASE)
_KINDS = {"email": "email", "link": "контакт", "handle": "контакт", "phone": "телефон"}

TOKEN = re.compile(r"\[(контакт|email|телефон|имя)(\d+)\]")


def redact(text: str) -> tuple[str, dict[str, str]]:
    """Текст без контактов и имён и таблица «метка → исходный фрагмент текста»."""
    table: dict[str, str] = {}
    seen: dict[tuple[str, str], str] = {}
    counts: dict[str, int] = {}

    def token(kind: str, value: str) -> str:
        key = (kind, value.lower())
        if key not in seen:
            counts[kind] = counts.get(kind, 0) + 1
            seen[key] = f"[{kind}{counts[kind]}]"
            table[seen[key]] = value
        return seen[key]

    # Один проход по всем видам контактов: метки нумеруются в порядке текста
    out = _CONTACT.sub(lambda m: token(_KINDS[m.lastgroup], m.group(0)), text)

    def name(m: re.Match) -> str:
        words = m.group(1).split()
        while words and words[-1].lower() in _NOT_NAMES:
            words.pop()
        if not words or words[0].lower() in _NOT_NAMES:
            return m.group(0)
        found = " ".join(words)
        start = m.start(1) - m.start(0)
        return m.group(0)[:start] + token("имя", found) + m.group(0)[start + len(found):]

    return NAME.sub(name, out), table


def restore(value: Optional[str], table: dict[str, str]) -> Optional[str]:
    """Метки в ответе модели → исходные значения; неизвестная метка остаётся как есть."""
    if not value or not table:
        return value
    return TOKEN.sub(lambda m: table.get(m.group(0), m.group(0)), value)


def restore_contact(value: Optional[str], table: dict[str, str]) -> tuple[Optional[str], Optional[str]]:
    """contact_value из ответа модели → (тип, значение). Модель возвращает метку контакта;
    метка без значения (модель её придумала) — контакта нет."""
    if not value:
        return None, None
    m = re.fullmatch(r"@?\[?(контакт|email)(\d+)\]?", value.strip())
    if not m:
        return None, value
    original = table.get(f"[{m.group(1)}{m.group(2)}]")
    if not original:
        return None, None
    if m.group(1) == "email":
        return "email", original
    # Для отклика нужен username: «@anna_hr» и «t.me/anna_hr» → «anna_hr»
    link = TG_LINK.fullmatch(original)
    return "telegram", link.group(1) if link else original.lstrip("@")
