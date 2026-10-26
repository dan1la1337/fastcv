-- Anti-Ghosting, вторая ступень (план 1.12): напоминание на 7-й день уже есть
-- (20261024080000_employer_reminder). Если и на 10-й день отклик без ответа (статус «новый»
-- или «просмотрен»), вакансии этого работодателя опускаются в ленте (1.5 → 0.9) и получают
-- значок «Отвечает редко». Ответил на все такие отклики — всё возвращается при пересчёте.

alter table public.vacancies add column if not exists employer_slow boolean not null default false;

create or replace function public.employer_is_slow(employer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select employer is not null and exists (
    select 1 from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
     where v.employer_id = employer
       and a.status in ('new', 'viewed')
       and a.created_at < now() - interval '10 days')
$$;
revoke execute on function public.employer_is_slow(uuid) from public, anon, authenticated;

-- Значок и место в ленте считает база, работодатель вписать их сам не может
create or replace function public.set_employer_slow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.employer_id is not null then
    new.employer_slow := public.employer_is_slow(new.employer_id);
    new.ranking_weight := case when new.employer_slow then 0.9 else 1.5 end;
  else
    new.employer_slow := false;
  end if;
  return new;
end;
$$;
revoke execute on function public.set_employer_slow() from public, anon, authenticated;

-- Имя после vacancies_rank: срабатывает последним и задаёт вес вакансий работодателей
create or replace trigger vacancies_zz_employer_slow
  before insert or update on public.vacancies
  for each row execute function public.set_employer_slow();

-- Пересчёт раз в час: отклики «стареют» без изменений самих вакансий
create or replace function public.refresh_employer_slow()
returns integer
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update public.vacancies v set employer_slow = public.employer_is_slow(v.employer_id)
     where v.employer_id is not null and v.archived_at is null
       and v.employer_slow is distinct from public.employer_is_slow(v.employer_id)
    returning 1)
  select count(*)::integer from changed;
$$;
revoke execute on function public.refresh_employer_slow() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('refresh-employer-slow', '17 * * * *', 'select public.refresh_employer_slow()');
  end if;
end;
$$;

select public.refresh_employer_slow();
