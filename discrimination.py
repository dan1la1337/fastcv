"""Дискриминационные требования в вакансии: возраст, пол, национальность.

Статья 64 ТК РФ запрещает отказывать в работе по полу, возрасту и национальности.
Признаки ищем двумя способами: модель возвращает поле discrimination по смыслу поста,
а правила ниже ловят явные формулировки без ИИ. Результат — список флагов
для vacancies.discrimination_flags: "age", "sex", "nationality".

Гражданство («гражданство РФ») не флагуем: для части работ его требует закон
(госслужба, допуск), и иностранцу нужен патент или разрешение на работу.
"""

from __future__ import annotations

import re
from typing import Iterable, Literal

Flag = Literal["age", "sex", "nationality"]
FLAGS: tuple[Flag, ...] = ("age", "sex", "nationality")

_I = re.IGNORECASE
_RULES: dict[Flag, re.Pattern] = {
    # «возраст 20–35», «возраст: до 40 лет», «не старше 45 лет», «от 18 до 30 лет»; «опыт от 3 лет» не подходит
    "age": re.compile(
        r"возраст\w*\s*[:—–-]?\s*(?:от|до|не старше|не более)?\s*\d{2}"
        r"|не\s+(?:старше|моложе)\s+\d{2}"
        r"|\b(?:от\s+\d{2}\s*)?до\s+\d{2}\s+(?:лет|года)\b"
        r"|\b(?:aged?|age limit)\s*(?:under|below|up to|:)?\s*\d{2}",
        _I),
    # «только мужчины», «ищем девушку», «пол: женский»
    "sex": re.compile(
        r"\b(?:только|исключительно)\s+(?:мужчин|женщин|девуш|девоч|парн|юнош)\w*"
        r"|\bпол\s*[:—–-]\s*(?:муж|жен)"
        r"|\b(?:ищем|требуется|требуются|нужна|нужен|нужны|приглашаем|в поиске)\s+(?:\w+\s+)?"
        r"(?:девушк|девушек|мужчин|женщин|парн|юнош)\w*"
        r"|\b(?:male|female)\s+only\b",
        _I),
    # «славянской внешности», «только русские», «национальность»
    "nationality": re.compile(
        r"славян\w*"
        r"|национальност\w*"
        r"|\bтолько\s+(?:русск|казах|узбек|армян|грузин|татар)\w*"
        r"|\bбез\s+акцента\b",
        _I),
}


# «Опыт работы от 10 до 15 лет», «стаж не моложе…» — про опыт, а не про возраст
_EXPERIENCE = re.compile(r"опыт|стаж|experience", _I)


def rule_flags(text: str) -> list[Flag]:
    """Флаги по явным формулировкам в тексте поста."""
    text = text or ""
    found = []
    for flag in FLAGS:
        for m in _RULES[flag].finditer(text):
            if flag == "age" and _EXPERIENCE.search(text[max(0, m.start() - 25):m.start()]):
                continue
            found.append(flag)
            break
    return found


def merge(*sources: Iterable[str]) -> list[str]:
    """Флаги модели и правил вместе, без повторов, в порядке FLAGS; чужие значения отбрасываем."""
    found = {flag for source in sources for flag in source}
    return [flag for flag in FLAGS if flag in found]
