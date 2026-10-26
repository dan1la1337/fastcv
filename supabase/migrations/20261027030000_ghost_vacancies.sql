-- Детектор вакансий-призраков (план 1.14).
-- Два сигнала: 1) одну и ту же вакансию публикуют повторно две недели и дольше
-- (по vacancy_sightings: от первого до последнего появления); 2) кандидаты нажимают
-- «Вакансия уже закрыта». От трёх таких отметок вакансия из Telegram и других внешних
-- источников уходит в архив; вакансии прямых работодателей только получают значок.

alter table public.vacancies
  add column if not exists last_seen_at timestamptz,
  add column if not exists closed_reports integer not null default 0;

-- Индекс свежести теперь помнит и последнее появление
create or replace function public.refresh_vacancy_freshness()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.vacancies v
     set first_seen_at = s.first_seen,
         last_seen_at = s.last_seen,
         channels_count = greatest(s.channels, 1)
    from (select min(coalesce(posted_at, seen_at)) as first_seen, max(coalesce(posted_at, seen_at)) as last_seen,
                 count(distinct lower(channel)) as channels
            from public.vacancy_sightings where vacancy_id = new.vacancy_id) s
   where v.id = new.vacancy_id;
  return null;
end;
$$;

-- Отметки «уже закрыта»: одна на пользователя и вакансию; напрямую таблицу не читают
create table if not exists public.vacancy_closed_reports (
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (vacancy_id, user_id)
);
create index if not exists vacancy_closed_reports_user_idx on public.vacancy_closed_reports (user_id, created_at desc);
alter table public.vacancy_closed_reports enable row level security;
revoke all on table public.vacancy_closed_reports from anon, authenticated;

-- Кандидат сообщает, что вакансия закрыта. Возвращает число отметок.
create or replace function public.report_vacancy_closed(vacancy uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v record;
  n integer;
begin
  if uid is null then
    raise exception 'Войдите, чтобы отметить вакансию' using errcode = '42501';
  end if;
  select id, employer_id, archived_at into v from public.vacancies where id = vacancy;
  if v.id is null then
    raise exception 'closed_report: вакансия не найдена' using errcode = '22023';
  end if;
  if v.employer_id = uid then
    raise exception 'closed_report: свою вакансию закройте в кабинете' using errcode = '22023';
  end if;
  -- Защита от накрутки: не больше 20 отметок в сутки с одного аккаунта
  if (select count(*) from public.vacancy_closed_reports
       where user_id = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'closed_report: на сегодня отметок достаточно, спасибо' using errcode = 'P0001';
  end if;
  insert into public.vacancy_closed_reports (vacancy_id, user_id) values (vacancy, uid)
  on conflict do nothing;
  select count(*) into n from public.vacancy_closed_reports where vacancy_id = vacancy;
  update public.vacancies
     set closed_reports = n,
         archived_at = case when n >= 3 and employer_id is null then coalesce(archived_at, now()) else archived_at end
   where id = vacancy;
  return n;
end;
$$;
revoke all on function public.report_vacancy_closed(uuid) from public, anon;
grant execute on function public.report_vacancy_closed(uuid) to authenticated;

-- Отметил ли текущий пользователь вакансию — для кнопки
create or replace function public.my_closed_report(vacancy uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.vacancy_closed_reports
                  where vacancy_id = vacancy and user_id = (select auth.uid()))
$$;
revoke all on function public.my_closed_report(uuid) from public, anon;
grant execute on function public.my_closed_report(uuid) to authenticated;

-- Счётчик отметок пишет только функция выше: работодатель не обнулит его своей вакансии
create or replace function public.prevent_closed_reports_tamper()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.closed_reports := 0;
    else
      new.closed_reports := old.closed_reports;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.prevent_closed_reports_tamper() from public, anon, authenticated;

create or replace trigger vacancies_prevent_closed_reports_tamper
  before insert or update on public.vacancies
  for each row execute function public.prevent_closed_reports_tamper();

-- Последнее появление у вакансий, которые уже публиковали повторно
update public.vacancies v
   set last_seen_at = s.last_seen
  from (select vacancy_id, max(coalesce(posted_at, seen_at)) as last_seen
          from public.vacancy_sightings group by vacancy_id having count(*) > 1) s
 where v.id = s.vacancy_id;
