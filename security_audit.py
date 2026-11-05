"""Ежемесячный аудит безопасности (план 1.2).

Раз в месяц из GitHub Actions (.github/workflows/security-audit.yml):
  1. база — функция security_audit(): таблицы без RLS, новые публичные функции
     SECURITY DEFINER, функции без search_path и т. п. сверх осознанных исключений;
  2. зависимости сайта — npm audit (только боевые пакеты);
  3. зависимости сборщика — pip-audit;
  4. напоминание о ротации ключей, если с прошлой прошло больше KEY_ROTATION_DAYS
     (дата — в app_settings.keys_rotated_at; ключи меняет владелец сам).
Отчёт — в Telegram владельцу и в сводку запуска. Скрипт ничего не исправляет.
"""
from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from typing import Callable, Optional

from main import notify

KEY_ROTATION_DAYS = 180
SEVERITY_ORDER = ("critical", "high", "moderate", "low", "info")
SEVERITY_RU = {"critical": "критических", "high": "высоких", "moderate": "средних", "low": "низких", "info": "info"}


def npm_findings(report: dict) -> dict[str, list[str]]:
    """Уязвимые пакеты из `npm audit --json` по уровням: {"high": ["next", …]}."""
    by_level: dict[str, list[str]] = {}
    for name, item in (report.get("vulnerabilities") or {}).items():
        level = item.get("severity") or "info"
        by_level.setdefault(level, []).append(name)
    return {level: sorted(names) for level, names in by_level.items()}


def pip_findings(report: object) -> list[str]:
    """«пакет версия: CVE…» из `pip-audit --format json` (формат со списком или с ключом dependencies)."""
    deps = report.get("dependencies", []) if isinstance(report, dict) else report or []
    out = []
    for dep in deps:
        ids = [v.get("id") for v in dep.get("vulns", []) if v.get("id")]
        if ids:
            out.append(f"{dep.get('name')} {dep.get('version')}: {', '.join(ids[:3])}")
    return out


def key_reminder(rotated_at: Optional[str], now: datetime) -> Optional[str]:
    if not rotated_at:
        return ("Дата последней ротации ключей не записана. После смены ключей Supabase, Gemini и ботов "
                "запишите её: app_settings.keys_rotated_at = ГГГГ-ММ-ДД.")
    try:
        days = (now - datetime.fromisoformat(rotated_at).replace(tzinfo=timezone.utc)).days
    except ValueError:
        return f"Не разобрал дату ротации ключей «{rotated_at}» — нужна ГГГГ-ММ-ДД."
    if days > KEY_ROTATION_DAYS:
        return f"Ключи не меняли {days} дней (норма — раз в полгода): Supabase, Gemini, боты Telegram, Resend."
    return None


def report_text(db: list[dict] | None, npm: dict[str, list[str]] | None, pip: list[str] | None,
                reminder: Optional[str]) -> tuple[str, bool]:
    """Текст отчёта и есть ли что исправлять (без учёта напоминаний и низких уровней)."""
    lines = ["🛡 Ежемесячный аудит безопасности FastCV", ""]
    problems = False

    if db is None:
        lines.append("База: проверка не выполнилась (см. лог).")
        problems = True
    elif db:
        problems = True
        lines.append(f"База: {len(db)} замечани{'е' if len(db) == 1 else 'й'}")
        lines += [f"• {f['name']} — {f['detail']}" for f in db[:15]]
    else:
        lines.append("База: ✅ ничего сверх осознанных исключений")

    if npm is None:
        lines.append("Сайт (npm): проверка не выполнилась.")
        problems = True
    else:
        serious = {lvl: npm[lvl] for lvl in ("critical", "high") if npm.get(lvl)}
        if serious:
            problems = True
        parts = [f"{len(npm[lvl])} {SEVERITY_RU[lvl]}" for lvl in SEVERITY_ORDER if npm.get(lvl)]
        lines.append("Сайт (npm): " + (", ".join(parts) if parts else "✅ уязвимостей нет"))
        for lvl, names in serious.items():
            lines.append(f"• {SEVERITY_RU[lvl]}: {', '.join(names[:10])}")

    if pip is None:
        lines.append("Сборщик (pip): проверка не выполнилась.")
        problems = True
    elif pip:
        problems = True
        lines.append(f"Сборщик (pip): {len(pip)} уязвимых пакетов")
        lines += [f"• {p}" for p in pip[:10]]
    else:
        lines.append("Сборщик (pip): ✅ уязвимостей нет")

    if reminder:
        lines += ["", "🔑 " + reminder]
    lines += ["", "Обновления пакетов приходят от Dependabot отдельными PR." if not problems
              else "Разбор — в Claude: «разбери аудит безопасности»."]
    return "\n".join(lines), problems


def run_json(cmd: list[str], run: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> Optional[object]:
    """JSON-вывод утилиты; npm audit и pip-audit выходят с кодом 1, когда что-то нашли, — это не ошибка."""
    try:
        result = run(cmd, capture_output=True, text=True, timeout=300)
        return json.loads(result.stdout) if result.stdout.strip() else None
    except (OSError, subprocess.TimeoutExpired, ValueError) as e:
        print(f"⚠️ {' '.join(cmd[:2])}: {type(e).__name__}")
        return None


def main() -> int:
    from supabase import create_client

    db_rows: list[dict] | None = None
    rotated: Optional[str] = None
    try:
        db = create_client(os.environ["SUPABASE_URL"].strip(), os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip())
        db_rows = db.rpc("security_audit", {}).execute().data or []
        rows = db.table("app_settings").select("value").eq("key", "keys_rotated_at").limit(1).execute().data
        rotated = rows[0]["value"] if rows else None
    except Exception as e:  # отчёт должен уйти, даже если база не ответила
        print(f"⚠️ База: {type(e).__name__}: {str(e)[:200]}")

    npm_raw = run_json(["npm", "audit", "--omit=dev", "--json"])
    pip_raw = run_json(["pip-audit", "-r", "requirements.txt", "--format", "json", "--progress-spinner", "off"])
    text, problems = report_text(
        db_rows,
        npm_findings(npm_raw) if isinstance(npm_raw, dict) else None,
        pip_findings(pip_raw) if pip_raw is not None else None,
        key_reminder(rotated, datetime.now(timezone.utc)),
    )
    print(text)
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("```\n" + text + "\n```\n")
    notify(text)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
