-- ИИ-разбор отказа: после отказа кандидат получает вероятные причины, чего не хватило
-- и что сделать дальше. Разбор пишет сайт (Gemini) от имени кандидата и хранит, чтобы
-- не тратить лимит повторно. Видит и пишет только сам кандидат и только по своему отказу.

create table if not exists public.rejection_analyses (
  application_id uuid primary key references public.applications (id) on delete cascade,
  candidate_id   uuid not null references public.profiles (id) on delete cascade,
  analysis       jsonb not null check (octet_length(analysis::text) <= 20000),
  created_at     timestamptz not null default now()
);
alter table public.rejection_analyses enable row level security;
revoke all on table public.rejection_analyses from anon, authenticated;
grant select, insert on table public.rejection_analyses to authenticated;

drop policy if exists rejection_analyses_select on public.rejection_analyses;
create policy rejection_analyses_select on public.rejection_analyses
  for select to authenticated
  using (candidate_id = (select auth.uid()));

drop policy if exists rejection_analyses_insert on public.rejection_analyses;
create policy rejection_analyses_insert on public.rejection_analyses
  for insert to authenticated
  with check (
    candidate_id = (select auth.uid())
    and exists (select 1 from public.applications a
                 where a.id = rejection_analyses.application_id
                   and a.candidate_id = (select auth.uid()) and a.status = 'rejected')
  );
