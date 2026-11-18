"""discrimination-rules.json работает и в Python: сборщик читает те же правила, что и сайт.

Шаблоны компилируются в re с IGNORECASE и дают тот же результат на примерах из файла,
что и src/lib/discrimination.ts на JavaScript.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

RULES = json.loads((Path(__file__).resolve().parents[1] / "discrimination-rules.json").read_text())


def flags(text: str) -> list[str]:
    found = []
    for flag, rule in RULES["flags"].items():
        guard = rule.get("not_after")
        for pattern in rule["patterns"]:
            hit = any(
                not guard or not re.search(guard["pattern"], text[max(0, m.start() - guard["window"]):m.start()], re.I)
                for m in re.finditer(pattern, text, re.I)
            )
            if hit:
                found.append(flag)
                break
    return found


CASES = [(flag, text, True) for flag, rule in RULES["flags"].items() for text in rule["examples"]["match"]] + [
    (flag, text, False) for flag, rule in RULES["flags"].items() for text in rule["examples"]["no_match"]
]


@pytest.mark.parametrize("flag,text,expected", CASES, ids=[f"{c[0]}:{c[1]}" for c in CASES])
def test_examples(flag, text, expected):
    assert (flag in flags(text)) is expected


def test_only_citizenship_is_flag_only():
    assert {f for f, r in RULES["flags"].items() if not r["block"]} == {"citizenship"}
    assert {f for f, r in RULES["flags"].items() if r["block"]} == {"age", "sex", "nationality"}
