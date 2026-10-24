"""Письма об откликах: группировка, тексты, отметки и повтор при сбое — без сети."""

import requests

import notifications


class Store:
    def __init__(self, queue):
        self.queue, self.marked = queue, []

    def pending_notifications(self):
        return self.queue

    def mark_notified(self, kind, ids):
        self.marked.append((kind, sorted(ids)))
        return len(ids)


def row(kind, app, email, title="Python-разработчик", status="new", **extra):
    return {"kind": kind, "application_id": app, "email": email, "vacancy_title": title, "status": status, **extra}


def test_employer_gets_one_digest_and_candidates_one_letter_each():
    store = Store([
        row("employer_new", "a1", "hr@acme.ru"),
        row("employer_new", "a2", "hr@acme.ru", title="QA"),
        row("employer_new", "a3", "hr@acme.ru"),
        row("candidate_status", "a4", "me@example.com", status="interview_scheduled", company="Acme", hr_message="Ждём в среду"),
        row("candidate_status", "a5", "me@example.com", status="rejected"),
    ])
    sent = []
    stats = notifications.send_notifications(store, lambda to, mail: sent.append((to, mail)))
    assert stats == {"sent": 3, "failed": 0, "queued": 5}
    hr = [m for to, m in sent if to == "hr@acme.ru"]
    assert len(hr) == 1 and hr[0]["subject"] == "3 новых отклика на FastCV"
    assert "Python-разработчик — 2 отклика" in hr[0]["html"] and "QA — 1 отклик" in hr[0]["html"]
    invite, reject = [m for to, m in sent if to == "me@example.com"]
    assert "пригласил" in invite["html"] and "Acme" in invite["html"] and "Ждём в среду" in invite["html"]
    assert "отказом" in reject["html"]
    assert ("employer_new", ["a1", "a2", "a3"]) in store.marked and ("candidate_status", ["a5"]) in store.marked


def test_failed_send_is_not_marked_and_html_is_escaped():
    store = Store([row("employer_new", "a1", "hr@acme.ru", title="<script>x</script>")])

    def down(to, mail):
        raise requests.ConnectionError("down")

    assert notifications.send_notifications(store, down)["failed"] == 1 and store.marked == []
    mail = notifications.employer_email(store.queue)
    assert "<script>" not in mail["html"] and "&lt;script&gt;" in mail["html"]


def test_sender_posts_to_resend_with_key():
    calls = []

    class Ok:
        def raise_for_status(self):
            pass

    send = notifications.make_sender("re_test", post=lambda url, **kw: (calls.append((url, kw)), Ok())[1])
    send("me@example.com", {"subject": "s", "html": "h"})
    url, kw = calls[0]
    assert url == notifications.API and kw["headers"]["Authorization"] == "Bearer re_test"
    assert kw["json"]["from"] == notifications.SENDER and kw["json"]["to"] == ["me@example.com"]


def test_employer_reminder_is_one_letter_per_employer():
    store = Store([
        row("employer_reminder", "r1", "hr@acme.ru", candidate_name="Анна"),
        row("employer_reminder", "r2", "hr@acme.ru", candidate_name="Иван", title="QA"),
        row("employer_new", "n1", "hr@acme.ru"),
    ])
    sent = []
    notifications.send_notifications(store, lambda to, mail: sent.append((to, mail)))
    subjects = sorted(m["subject"] for _, m in sent)
    assert subjects == ["1 новый отклик на FastCV", "2 отклика ждут вашего ответа"]
    reminder = next(m for _, m in sent if "ждут" in m["subject"])
    assert "Анна — Python-разработчик" in reminder["html"] and "Иван — QA" in reminder["html"]
    assert ("employer_reminder", ["r1", "r2"]) in store.marked
