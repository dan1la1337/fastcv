"""PDF открытого резюме доступен работодателю из базы резюме без отклика (#143)."""

from __future__ import annotations

import pytest

from test_rls import database, psql  # noqa: F401  (фикстура database: чистая база со всеми миграциями)

C = "00000000-0000-0000-0000-0000000143c1"   # кандидат с PDF
C2 = "00000000-0000-0000-0000-0000000143c2"  # другой кандидат
E = "00000000-0000-0000-0000-0000000143e1"   # работодатель, кандидат ему не откликался
PDF = f"select count(*) from storage.objects where bucket_id = 'resumes' and name = '{C}/resume.pdf'"


def set_public(value: bool):
    ok, out = psql(f"update profiles set resume_public = {str(value).lower()}, resume_path = '{C}/resume.pdf' where id = auth.uid()",
                   role="authenticated", uid=C)
    assert ok, out


@pytest.fixture(scope="module", autouse=True)
def data(database):  # noqa: F811
    ok, out = psql(f"""insert into auth.users values ('{C}', '{{"role":"candidate"}}'), ('{C2}', '{{"role":"candidate"}}'),
            ('{E}', '{{"role":"employer"}}');
        update profiles set name = 'Board' where id = '{C}';
        insert into storage.objects (bucket_id, name, owner) values ('resumes', '{C}/resume.pdf', '{C}')""")
    assert ok, out


def test_employer_reads_public_resume_pdf_without_application():
    set_public(True)
    ok, out = psql("select has_pdf from resume_board()", role="authenticated", uid=E)
    assert (ok, out) == (True, "t")
    ok, out = psql(PDF, role="authenticated", uid=E)
    assert (ok, out) == (True, "1")


def test_other_candidate_does_not_read_public_resume_pdf():
    ok, out = psql(PDF, role="authenticated", uid=C2)
    assert (ok, out) == (True, "0")


def test_hidden_resume_pdf_is_closed_again():
    set_public(False)
    ok, out = psql(PDF, role="authenticated", uid=E)
    assert (ok, out) == (True, "0")


def test_employer_still_does_not_see_candidate_profile():
    ok, out = psql(f"select count(*) from profiles where id = '{C}'", role="authenticated", uid=E)
    assert (ok, out) == (True, "0")
