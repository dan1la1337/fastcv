from datetime import datetime, timezone

import security_audit as sa


def test_npm_findings_grouped_by_severity():
    report = {"vulnerabilities": {"next": {"severity": "high"}, "postcss": {"severity": "moderate"}, "ajv": {"severity": "high"}}}
    assert sa.npm_findings(report) == {"high": ["ajv", "next"], "moderate": ["postcss"]}


def test_pip_findings_both_formats():
    deps = [{"name": "requests", "version": "2.0", "vulns": [{"id": "CVE-1"}, {"id": "GHSA-2"}]},
            {"name": "ok", "version": "1", "vulns": []}]
    assert sa.pip_findings({"dependencies": deps}) == ["requests 2.0: CVE-1, GHSA-2"]
    assert sa.pip_findings(deps) == ["requests 2.0: CVE-1, GHSA-2"]


def test_key_reminder():
    now = datetime(2026, 10, 30, tzinfo=timezone.utc)
    assert "не записана" in sa.key_reminder(None, now)
    assert sa.key_reminder("2026-09-01", now) is None
    assert "Ключи не меняли" in sa.key_reminder("2026-01-01", now)
    assert "Не разобрал" in sa.key_reminder("вчера", now)


def test_clean_report_has_no_problems():
    text, problems = sa.report_text([], {"low": ["x"]}, [], None)
    assert not problems
    assert "База: ✅" in text and "1 низких" in text and "Сборщик (pip): ✅" in text


def test_report_flags_db_and_high_npm_and_failed_checks():
    text, problems = sa.report_text(
        [{"name": "new_fn", "detail": "SECURITY DEFINER функция доступна без входа"}],
        {"high": ["next"]}, None, "Ключи не меняли 200 дней")
    assert problems
    assert "• new_fn — SECURITY DEFINER" in text
    assert "высоких: next" in text
    assert "Сборщик (pip): проверка не выполнилась" in text
    assert "🔑 Ключи не меняли" in text
