-- Рейтинг найма, слои 1–2 (план 1.13).
-- Слой 1: по откликам за 90 дней — доля откликов с ответом (приглашение или отказ) и типичное
-- время до ответа. Слой 2: через 2 дня после приглашения кандидат оценивает собеседование
-- (1–5) — по ссылкам-кнопкам из бота подборок или на странице «Мои отклики».
-- Итог хранится в vacancies.employer_stats (jsonb) и показывается значками у компании.

-- Когда работодатель впервые ответил (пригласил или отказал). Ставит только база:
-- hr_replied_at пишет сайт и его можно подделать, этим полем — нельзя.
alter table public.applications add column if not exists answered_at timestamptz;

create or replace function public.applications_set_answered_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.answered_at := null;
  elsif old.answered_at is not null then
    new.answered_at := old.answered_at;
  elsif new.status in ('interview_scheduled', 'rejected') then
    new.answered_at := now();
  else
    new.answered_at := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.applications_set_answered_at() from public, anon, authenticated;

create or replace trigger applications_answered_at
  before insert or update on public.applications
  for each row execute function public.applications_set_answered_at();

-- Старые отклики с ответом: лучшее, что известно, — время ответа с сайта
update public.applications
   set answered_at = coalesce(hr_replied_at, viewed_at, created_at)
 where status in ('interview_scheduled', 'rejected') and answered_at is null;

-- Опросы о собеседованиях. Строка появляется, когда сборщик отправил опрос в бот;
-- token — секрет ссылки из бота (id отклика не годится: его видит работодатель).
-- Читать и писать напрямую нельзя — только через функции ниже.
create table if not exists public.interview_feedback (
  application_id uuid primary key references public.applications (id) on delete cascade,
  token          uuid not null unique default gen_random_uuid(),
  rating         smallint check (rating between 1 and 5),
  sent_at        timestamptz,
  rated_at       timestamptz
);
alter table public.interview_feedback enable row level security;
revoke all on table public.interview_feedback from anon, authenticated;

-- Оценка по ссылке из бота — без входа, по секрету опроса
create or replace function public.rate_interview(token uuid, rating integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  app uuid;
begin
  if rating is null or rating not between 1 and 5 then
    raise exception 'rating: оценка от 1 до 5' using errcode = '22023';
  end if;
  select f.application_id into app
    from public.interview_feedback f
    join public.applications a on a.id = f.application_id
   where f.token = rate_interview.token and a.status = 'interview_scheduled'
     and f.sent_at > now() - interval '60 days';
  if app is null then
    return false;
  end if;
  update public.interview_feedback set rating = rate_interview.rating, rated_at = now()
   where application_id = app;
  return true;
end;
$$;
revoke all on function public.rate_interview(uuid, integer) from public;
grant execute on function public.rate_interview(uuid, integer) to anon, authenticated;

-- Оценка кандидатом на странице «Мои отклики»: только свой отклик с приглашением
create or replace function public.rate_my_interview(application uuid, rating integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if rating is null or rating not between 1 and 5 then
    raise exception 'rating: оценка от 1 до 5' using errcode = '22023';
  end if;
  if not exists (select 1 from public.applications a
                  where a.id = application and a.candidate_id = (select auth.uid())
                    and a.status = 'interview_scheduled' and a.answered_at > now() - interval '60 days') then
    return false;
  end if;
  insert into public.interview_feedback (application_id, rating, rated_at)
  values (application, rating, now())
  on conflict (application_id) do update set rating = excluded.rating, rated_at = now();
  return true;
end;
$$;
revoke all on function public.rate_my_interview(uuid, integer) from public, anon;
grant execute on function public.rate_my_interview(uuid, integer) to authenticated;

-- Оценки кандидата по его откликам — для страницы «Мои отклики»
create or replace function public.my_interview_ratings()
returns table (application_id uuid, rating smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select f.application_id, f.rating
    from public.interview_feedback f
    join public.applications a on a.id = f.application_id
   where a.candidate_id = (select auth.uid()) and f.rating is not null
$$;
revoke all on function public.my_interview_ratings() from public, anon;
grant execute on function public.my_interview_ratings() to authenticated;

-- Опросы к отправке (вызывает сборщик): приглашение 2–14 дней назад, у кандидата есть бот
create or replace function public.interview_surveys_due()
returns table (application_id uuid, chat_id bigint, title text, company text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, p.telegram_chat_id, v.title, v.company_name
    from public.applications a
    join public.vacancies v on v.id = a.vacancy_id
    join public.profiles p on p.id = a.candidate_id
   where a.status = 'interview_scheduled'
     and a.answered_at between now() - interval '14 days' and now() - interval '2 days'
     and p.telegram_chat_id is not null
     and not exists (select 1 from public.interview_feedback f where f.application_id = a.id)
   order by a.answered_at
   limit 100
$$;
revoke all on function public.interview_surveys_due() from public, anon, authenticated;
grant execute on function public.interview_surveys_due() to service_role;

-- Сборщик отправляет опрос: создаёт строку и получает секрет для ссылок
create or replace function public.start_interview_survey(application uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.interview_feedback (application_id, sent_at) values (application, now())
  on conflict (application_id) do update set sent_at = now()
  returning token
$$;
revoke all on function public.start_interview_survey(uuid) from public, anon, authenticated;
grant execute on function public.start_interview_survey(uuid) to service_role;

-- Сводка по работодателю: rate (% откликов с ответом), hours (медиана до ответа),
-- rating и ratings (средняя оценка собеседований и их число). Пустые части не пишем:
-- слой 1 — от 5 откликов старше 3 дней, слой 2 — от 3 оценок.
create or replace function public.employer_hiring_stats(employer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with apps as (
    select a.created_at, a.answered_at
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
     where v.employer_id = employer
       and a.created_at between now() - interval '90 days' and now() - interval '3 days'
  ), replies as (
    select count(*) as total, count(answered_at) as answered,
           percentile_cont(0.5) within group (order by extract(epoch from answered_at - created_at)) as seconds
      from apps
  ), feedback as (
    select count(*) as n, round(avg(f.rating), 1) as rating
      from public.interview_feedback f
      join public.applications a on a.id = f.application_id
      join public.vacancies v on v.id = a.vacancy_id
     where v.employer_id = employer and f.rating is not null and f.rated_at > now() - interval '365 days'
  )
  select case when employer is null then '{}'::jsonb else jsonb_strip_nulls(jsonb_build_object(
    'rate',    case when r.total >= 5 then round(100.0 * r.answered / r.total)::int end,
    'hours',   case when r.total >= 5 and r.answered > 0 then greatest(1, round(r.seconds / 3600))::int end,
    'rating',  case when f.n >= 3 then f.rating end,
    'ratings', case when f.n >= 3 then f.n end)) end
    from replies r, feedback f
$$;
revoke execute on function public.employer_hiring_stats(uuid) from public, anon, authenticated;

alter table public.vacancies add column if not exists employer_stats jsonb not null default '{}'::jsonb;

-- Тот же триггер, что ставит «Отвечает редко», теперь заполняет и сводку
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
    new.employer_stats := public.employer_hiring_stats(new.employer_id);
  else
    new.employer_slow := false;
    new.employer_stats := '{}'::jsonb;
  end if;
  return new;
end;
$$;

-- Ежечасный пересчёт (задача pg_cron refresh-employer-slow уже есть)
create or replace function public.refresh_employer_slow()
returns integer
language sql
security definer
set search_path = ''
as $$
  with fresh as (
    select v.id, public.employer_is_slow(v.employer_id) as slow, public.employer_hiring_stats(v.employer_id) as stats
      from public.vacancies v
     where v.employer_id is not null and v.archived_at is null
  ), changed as (
    update public.vacancies v set employer_slow = f.slow
      from fresh f
     where v.id = f.id and (v.employer_slow, v.employer_stats) is distinct from (f.slow, f.stats)
    returning 1)
  select count(*)::integer from changed;
$$;
revoke execute on function public.refresh_employer_slow() from public, anon, authenticated;

select public.refresh_employer_slow();
