-- FastCV: схема базы и правила доступа (RLS) для Supabase.
--
-- Как применить: Supabase → SQL Editor → вставить файл целиком → Run.
-- Скрипт можно запускать повторно. Существующие таблицы он не пересоздаёт
-- и данные не трогает: создаёт только недостающее, включает RLS и
-- переустанавливает политики.
--
-- Описания таблиц совпадают с рабочей базой проекта (сверено 22.10.2026).
--
-- Кто что может:
--   * вакансии читают все; публикует только работодатель и только от своего имени;
--     сборщик (main.py) пишет с service-role ключом, который обходит RLS;
--   * отклик создаёт только кандидат от своего имени; видят его кандидат и
--     работодатель-владелец вакансии; работодатель меняет только статус;
--   * роль задаётся один раз при регистрации и дальше не меняется;
--   * таблицы channels и companies доступны только через service-role.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Таблицы
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  role        varchar not null check (role in ('candidate', 'employer')),
  name        text not null,
  description text,
  skills      jsonb default '[]'::jsonb,
  trust_score integer default 100,
  created_at  timestamptz default timezone('utc', now())
);

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  domain      text unique,
  trust_score numeric default 5.0,
  is_claimed  boolean default false,
  owner_id    uuid
);

create table if not exists public.vacancies (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references public.companies (id),
  raw_hash       text unique,
  title          text not null,
  description    text,
  salary_min     integer,
  salary_max     integer,
  city           text,
  is_remote      boolean,
  contact_type   text,
  contact_value  text,
  ranking_weight double precision default 1.0,
  created_at     timestamptz default now(),
  source_type    text default 'external' check (source_type in ('internal', 'external')),
  employer_id    uuid references public.profiles (id)
);

create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  vacancy_id    uuid references public.vacancies (id),
  candidate_id  uuid references public.profiles (id),
  cover_letter  text,
  status        varchar default 'new' check (status in ('new', 'viewed', 'interview_scheduled', 'rejected')),
  hr_replied_at timestamptz,
  created_at    timestamptz default timezone('utc', now())
);

create table if not exists public.channels (
  id             serial primary key,
  username       text not null unique,
  category       text default 'general',
  is_active      boolean default true,
  last_parsed_at timestamptz
);

-- Этап 2: источник поста, дата публикации, архив, стек технологий.
-- Отдельные alter table — чтобы скрипт обновлял и базы, созданные раньше.
alter table public.vacancies
  add column if not exists source_post text,                       -- "канал/id поста", устойчив к правкам поста
  add column if not exists source_url  text,                       -- ссылка на оригинальный пост
  add column if not exists posted_at   timestamptz,                -- когда пост вышел в Telegram
  add column if not exists archived_at timestamptz,                -- не показывается в ленте
  add column if not exists stack       jsonb not null default '[]'::jsonb,
  add column if not exists salary_currency text,
  add column if not exists company_name text;                      -- компания-работодатель (из поста или профиля)                   -- ISO-код (RUB, USD…); null — валюта неизвестна

alter table public.channels
  add column if not exists last_post_id bigint,                    -- последний обработанный пост
  add column if not exists last_error   text,
  add column if not exists failed_runs  integer not null default 0; -- запусков подряд без доступа к ленте

create unique index if not exists vacancies_source_post_key on public.vacancies (source_post);
create index if not exists vacancies_company_idx on public.vacancies (company_id);
create index if not exists vacancies_feed_idx on public.vacancies (created_at desc) where archived_at is null;
create index if not exists vacancies_created_at_idx on public.vacancies (created_at desc);
create index if not exists vacancies_employer_idx   on public.vacancies (employer_id);
create index if not exists applications_vacancy_idx on public.applications (vacancy_id);
create index if not exists applications_candidate_idx on public.applications (candidate_id);

-- ---------------------------------------------------------------------------
-- Роль пользователя
-- ---------------------------------------------------------------------------

-- Роль текущего пользователя. security definer — чтобы политики могли
-- читать profiles без рекурсии RLS.
create or replace function public.app_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Профиль создаётся автоматически при регистрации, с ролью из формы.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- name обязателен; пустое имя пользователь заполнит в профиле после входа
  insert into public.profiles (id, role, name)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'employer' then 'employer' else 'candidate' end,
    ''
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Профили для пользователей, зарегистрированных до появления триггера
insert into public.profiles (id, role, name)
select
  u.id,
  case when u.raw_user_meta_data ->> 'role' = 'employer' then 'employer' else 'candidate' end,
  ''
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- Архивация устаревших вакансий из Telegram. Вызывает только сборщик
-- (service-role); вакансии прямых работодателей не трогает.
create or replace function public.archive_stale_vacancies(days integer default 30)
returns integer
language sql
security definer
set search_path = public
as $$
  with archived as (
    update public.vacancies
       set archived_at = now()
     where archived_at is null
       and source_type = 'external'
       and coalesce(posted_at, created_at) < now() - make_interval(days => days)
    returning 1
  )
  select count(*)::integer from archived;
$$;

-- Пользователь не может сменить себе роль. Администратор (SQL Editor,
-- service-role) — может: у таких запросов нет auth.uid().
create or replace function public.prevent_role_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'Роль аккаунта нельзя изменить';
  end if;
  return new;
end;
$$;

create or replace trigger profiles_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.vacancies    enable row level security;
alter table public.applications enable row level security;
alter table public.channels     enable row level security;
alter table public.companies    enable row level security;

-- Снимаем все старые политики, чтобы не осталось открытых правил
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'vacancies', 'applications', 'channels', 'companies')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$$;

-- profiles --------------------------------------------------------------------

-- Свой профиль; профили работодателей (название компании) видны всем вошедшим;
-- профиль кандидата виден работодателю, на чью вакансию он откликнулся.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or role = 'employer'
    or exists (
      select 1
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
      where a.candidate_id = profiles.id
        and v.employer_id = (select auth.uid())
    )
  );

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- vacancies -------------------------------------------------------------------

create policy vacancies_select on public.vacancies
  for select to anon, authenticated
  using (true);

create policy vacancies_insert on public.vacancies
  for insert to authenticated
  with check (
    (select public.app_user_role()) = 'employer'
    and employer_id = (select auth.uid())
    and source_type = 'internal'
    and ranking_weight <= 1.5
  );

create policy vacancies_update on public.vacancies
  for update to authenticated
  using (employer_id = (select auth.uid()))
  with check (employer_id = (select auth.uid()) and source_type = 'internal' and ranking_weight <= 1.5);

create policy vacancies_delete on public.vacancies
  for delete to authenticated
  using (employer_id = (select auth.uid()));

-- applications ----------------------------------------------------------------

create policy applications_select on public.applications
  for select to authenticated
  using (
    candidate_id = (select auth.uid())
    or exists (
      select 1 from public.vacancies v
      where v.id = applications.vacancy_id and v.employer_id = (select auth.uid())
    )
  );

create policy applications_insert on public.applications
  for insert to authenticated
  with check (
    candidate_id = (select auth.uid())
    and (select public.app_user_role()) = 'candidate'
    and status = 'new'
    and hr_replied_at is null
  );

create policy applications_update on public.applications
  for update to authenticated
  using (
    exists (
      select 1 from public.vacancies v
      where v.id = applications.vacancy_id and v.employer_id = (select auth.uid())
    )
  );

-- Работодатель может менять в отклике только статус и время ответа
create or replace function public.prevent_application_tamper()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and (
       new.id, new.vacancy_id, new.candidate_id, new.cover_letter, new.created_at
     ) is distinct from (
       old.id, old.vacancy_id, old.candidate_id, old.cover_letter, old.created_at
     ) then
    raise exception 'В отклике можно менять только статус';
  end if;
  return new;
end;
$$;

create or replace trigger applications_prevent_tamper
  before update on public.applications
  for each row execute function public.prevent_application_tamper();

-- Служебные функции не должны вызываться напрямую через API (/rest/v1/rpc).
-- app_user_role нужна вошедшим пользователям: её вызывают политики.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.archive_stale_vacancies(integer) from public, anon, authenticated;
grant execute on function public.archive_stale_vacancies(integer) to service_role;
revoke execute on function public.app_user_role() from public, anon;
grant execute on function public.app_user_role() to authenticated;

-- channels и companies: политик нет — доступ только у service-role
-- (channels читает и обновляет сборщик, companies кодом пока не используется)

-- ---------------------------------------------------------------------------
-- Лимит запросов к ИИ (сопроводительные письма и другие генерации)
-- ---------------------------------------------------------------------------
-- Каждый вызов ИИ записывается в ai_usage. Проверка и запись делаются одной
-- функцией под блокировкой на пользователя, поэтому параллельные запросы не
-- обходят лимит. Прямого доступа к таблице нет ни у кого, кроме service-role.

create table if not exists public.ai_usage (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_kind_time_idx on public.ai_usage (user_id, kind, created_at desc);

alter table public.ai_usage enable row level security;

-- Разрешить вызов или отказать. Возвращает {"allowed": bool, "retry_after": секунды}.
create or replace function public.consume_ai_quota(
  quota_kind text,
  max_calls integer,
  window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  used integer;
  oldest timestamptz;
begin
  if uid is null then
    raise exception 'Нужна авторизация';
  end if;
  -- Потолок параметров: функцию можно вызвать и напрямую, и без него пользователь
  -- мог бы записать в таблицу сколько угодно строк
  if max_calls not between 1 and 100 or window_seconds not between 1 and 86400 or length(quota_kind) > 40 then
    raise exception 'Некорректные параметры лимита';
  end if;

  -- Один пользователь — одна проверка за раз
  perform pg_advisory_xact_lock(hashtext('ai_quota:' || uid::text));

  select count(*), min(created_at)
    into used, oldest
    from public.ai_usage
   where user_id = uid
     and kind = quota_kind
     and created_at > now() - make_interval(secs => window_seconds);

  if used >= max_calls then
    return jsonb_build_object(
      'allowed', false,
      'retry_after', greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => window_seconds) - now()))))::integer
    );
  end if;

  insert into public.ai_usage (user_id, kind) values (uid, quota_kind);
  return jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;

revoke execute on function public.consume_ai_quota(text, integer, integer) from public, anon;
grant execute on function public.consume_ai_quota(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Резюме (Supabase Storage)
-- ---------------------------------------------------------------------------
-- Файл кандидата лежит в приватном бакете resumes по пути <user_id>/resume.pdf.
-- Кандидат управляет только своей папкой; работодатель может прочитать резюме
-- только тех кандидатов, которые откликнулись на его вакансии.

alter table public.profiles add column if not exists resume_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- create policy не умеет "if not exists": создаём только недостающие
do $$
declare
  own_folder constant text := $c$bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text$c$;
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'resumes_owner_select') then
    execute 'create policy resumes_owner_select on storage.objects for select to authenticated using (' || own_folder || ')';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'resumes_owner_insert') then
    execute 'create policy resumes_owner_insert on storage.objects for insert to authenticated with check (' || own_folder || ')';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'resumes_owner_update') then
    execute 'create policy resumes_owner_update on storage.objects for update to authenticated using (' || own_folder || ') with check (' || own_folder || ')';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'resumes_owner_delete') then
    execute 'create policy resumes_owner_delete on storage.objects for delete to authenticated using (' || own_folder || ')';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'resumes_employer_select') then
    execute $p$
      create policy resumes_employer_select on storage.objects for select to authenticated
      using (
        bucket_id = 'resumes'
        and exists (
          select 1
          from public.applications a
          join public.vacancies v on v.id = a.vacancy_id
          where v.employer_id = auth.uid()
            and a.candidate_id::text = (storage.foldername(name))[1]
        )
      )
    $p$;
  end if;
end;
$$;
