-- ИИ-скрининг откликов: короткий вердикт по отклику для работодателя (подходит / возможно /
-- слабое совпадение, плюсы, минусы, что спросить на собеседовании). Пишет сайт от имени
-- работодателя; видит, пишет и удаляет только работодатель вакансии. Кандидату не виден.

create table if not exists public.application_screenings (
  application_id uuid primary key references public.applications (id) on delete cascade,
  employer_id    uuid not null references public.profiles (id) on delete cascade,
  screening      jsonb not null check (octet_length(screening::text) <= 10000),
  created_at     timestamptz not null default now()
);
create index if not exists application_screenings_employer_idx on public.application_screenings (employer_id);
alter table public.application_screenings enable row level security;
revoke all on table public.application_screenings from anon, authenticated;
grant select, insert, delete on table public.application_screenings to authenticated;

drop policy if exists application_screenings_select on public.application_screenings;
create policy application_screenings_select on public.application_screenings
  for select to authenticated
  using (employer_id = (select auth.uid()));

drop policy if exists application_screenings_insert on public.application_screenings;
create policy application_screenings_insert on public.application_screenings
  for insert to authenticated
  with check (
    employer_id = (select auth.uid())
    and exists (select 1 from public.applications a join public.vacancies v on v.id = a.vacancy_id
                 where a.id = application_screenings.application_id and v.employer_id = (select auth.uid()))
  );

drop policy if exists application_screenings_delete on public.application_screenings;
create policy application_screenings_delete on public.application_screenings
  for delete to authenticated
  using (employer_id = (select auth.uid()));
