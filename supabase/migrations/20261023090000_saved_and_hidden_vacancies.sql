-- Избранное и скрытые вакансии пользователя.
-- kind = 'saved' — в избранном, 'hidden' — не показывать в ленте. Одна строка на пару
-- (пользователь, вакансия): сохранить скрытую вакансию значит перестать её скрывать.

create table if not exists public.vacancy_marks (
  user_id    uuid not null references auth.users (id) on delete cascade,
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  kind       text not null check (kind in ('saved', 'hidden')),
  created_at timestamptz not null default now(),
  primary key (user_id, vacancy_id)
);

create index if not exists vacancy_marks_user_kind_idx on public.vacancy_marks (user_id, kind, created_at desc);
create index if not exists vacancy_marks_vacancy_idx on public.vacancy_marks (vacancy_id);

alter table public.vacancy_marks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vacancy_marks' and policyname = 'vacancy_marks_select_own') then
    create policy vacancy_marks_select_own on public.vacancy_marks
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vacancy_marks' and policyname = 'vacancy_marks_insert_own') then
    create policy vacancy_marks_insert_own on public.vacancy_marks
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vacancy_marks' and policyname = 'vacancy_marks_update_own') then
    create policy vacancy_marks_update_own on public.vacancy_marks
      for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vacancy_marks' and policyname = 'vacancy_marks_delete_own') then
    create policy vacancy_marks_delete_own on public.vacancy_marks
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end;
$$;

-- Подборка «Для вас» не показывает скрытые вакансии
create or replace function public.recommended_vacancies(page_size integer default 30, page integer default 0)
returns table (id uuid, score integer, matched jsonb, missing jsonb)
language sql
stable
set search_path = ''
as $$
  select v.id, (m ->> 'score')::int as score, m -> 'matched', m -> 'missing'
  from public.profiles p
  join public.vacancies v on v.archived_at is null
  cross join lateral public.vacancy_match(v, p) m
  where p.id = (select auth.uid()) and p.role = 'candidate'
    and not exists (
      select 1 from public.vacancy_marks h
      where h.user_id = p.id and h.vacancy_id = v.id and h.kind = 'hidden'
    )
  order by score desc, coalesce(v.posted_at, v.created_at) desc, v.id
  limit least(greatest(page_size, 1), 50) offset greatest(page, 0) * least(greatest(page_size, 1), 50)
$$;
