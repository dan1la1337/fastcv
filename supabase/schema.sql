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

-- ---------------------------------------------------------------------------
-- Нормализация вакансий: уровень, направление, формат работы, город; дубли
-- ---------------------------------------------------------------------------
-- Сборщик берёт эти поля у Gemini; если их нет (вакансии работодателей,
-- старые записи), триггер заполняет их по названию правилами ниже.

-- Уровень по названию должности; при нескольких («Middle/Senior») берём нижний,
-- чтобы вакансию увидел и тот, кто фильтрует по нижнему уровню.
create or replace function public.vacancy_level(title text, description text default null)
returns text language sql immutable set search_path = '' as $$
  select case
    when t ~* '(стаж[её]р|стажировк|intern\M|internship|trainee)' then 'intern'
    when t ~* '(\mjunior|джун|младш|начинающ|ассистент|помощник|assistant)' then 'junior'
    when t ~* '(\mmiddle|мидл)' then 'middle'
    when t ~* '(\msenior|сеньор|синьор|ведущ|старш|главн)' then 'senior'
    when t ~* '(\mlead\M|тимлид|техлид|\mhead\M|руководител|начальник|principal|архитектор|architect|\mcto\M|\mcoo\M|\mceo\M|chief|директор|director|шеф)' then 'lead'
    when d ~* '(\mjunior)' then 'junior'
    when d ~* '(\mmiddle)' then 'middle'
    when d ~* '(\msenior)' then 'senior'
  end
  from (select coalesce(title, '') as t, coalesce(description, '') as d) x
$$;

-- Направление: сначала по названию, порядок правил важен
-- («QA Automation на Python» — это QA, «Mobile product designer» — дизайн,
-- «Менеджер по продажам кредитных продуктов» — продажи). Если по названию
-- не понять, смотрим на технологии.
create or replace function public.vacancy_direction(title text, stack jsonb default null)
returns text language sql immutable set search_path = '' as $$
  select case
    when t ~* '(безопасност|security|pentest|пентест|appsec|devsecops|\msoc\M|antifraud|антифрод)' then 'security'
    when t ~* '(\mqa\M|\maqa\M|тестировщ|tester|тестирован|quality assurance|sdet)' then 'qa'
    when t ~* '(\munity\M|unreal|gamedev|геймдизайн|game|игров|\mlevel )' then 'gamedev'
    when t ~* '(дизайн|design|\mui\M|\mux\M|motion|моушн|иллюстратор|художник|artist|аниматор|animator|\m[23]d\M|арт-директор|art director|creative director)' then 'design'
    when t ~* '(devops|\msre\M|site reliability|инфраструктур|системн\w* администратор|сисадмин|\madmin|platform engineer|\mdba\M|администратор баз)' then 'devops'
    when t ~* '(data scien|scientist|data[- ]engineer|data integration|machine learning|\mml\M|\mml-|\mai\M|\mai-|\mии\M|\mllm|нейросет|data engineer|инженер данных|computer vision|\mcv\M|\mnlp\M|deep learning|\mdwh\M|\metl\M|mlops|prompt|robotics)' then 'data_ml'
    when t ~* '(аналитик|analyst|analytics)' then 'analytics'
    when t ~* '(android|\mios\M|\mswift|flutter|react native|mobile|мобильн)' then 'mobile'
    when t ~* '(fullstack|full-stack|full stack|фулстек|фуллстек)' then 'fullstack'
    when t ~* '(frontend|front-end|front end|фронтенд|фронт-энд|верстальщик|верстк|лендинг|\mreact\M|\mvue|angular)' then 'frontend'
    when t ~* '(поддержк|support|helpdesk|help desk|оператор|call-центр|колл-центр|контакт-центр|customer success|техподдерж|клиентского сервиса|обслуживани)' then 'support'
    when t ~* '(маркет|marketing|\msmm|\mсмм|\mseo|\mpr\M|\mpr-|таргет|реклам|бренд|brand|reels|рилс|медиабай|медиаплан|трафик|traffic|growth|\mcmo\M|директолог|контекстолог|google ads|директ\M|продвиж|influence|инфлюенс|\mugc|сторис|креатор|социальн|соцсет|instagram|tiktok|community|сообществ|linkbuild|\mpbn\M|paid media|контент|content)' then 'marketing'
    when t ~* '(редактор|editor|журналист|сценарист|\mавтор|копирайт|copywrit|писател|радиоведущ|продюсер|producer|режисс|монтаж|звукорежисс|саунд|видео|video|фотограф)' then 'content'
    when t ~* '(продаж|sales|account|аккаунт|business development|развити\w* бизнес|развити\w* партн|bizdev|\mbdm\M|закупк|снабжен|tender|тендер|торгов|клиент|партн[её]р|агент|ozon|wildberries|маркетплейс|категорийн)' then 'sales'
    when t ~* '(product manager|product owner|head of product|продакт|менеджер продукта|продукт-менеджер|продуктов\w* менеджер|развити\w* продукт|project manager|проджект|менеджер проект|менеджер по проект|менеджер спецпроект|руководител\w* (it |ит )?проект|scrum|agile|delivery manager|head of production|\mcpo\M|\mpm\M|\mpo\M)' then 'product'
    when t ~* '(\mhr\M|\mhr-|рекрут|recruit|персонал|talent|\mhrbp|retention)' then 'hr'
    when t ~* '(бухгалт|финанс|accountant|finance|взыскани|кредит|ипотек|страхов|рефинанс|\mбки\M|экономист|казначей)' then 'finance'
    when t ~* '(преподават|репетитор|педагог|учител|наставник|лектор|тренер|куратор|teacher|tutor|методист)' then 'education'
    when t ~* '(backend|back-end|бэкенд|бекенд|python|\mjava\M|golang|\mgo\M|\mphp|ruby|\mc#|\.net|node|rust|scala|c\+\+|\m1[сc]\M|программист|разработчик|разработк|developer|engineer|инженер-программист|\mdev\M|битрикс|bitrix|wordpress|чат-бот|chatbot)' then 'backend'
    when s ~* '(android|\mios\M|swift|kotlin|flutter)' then 'mobile'
    when s ~* '(\mreact\M|\mvue|angular|typescript|javascript)' then 'frontend'
    when s ~* '(python|\mjava\M|\mgo\M|golang|php|c#|\.net|node)' then 'backend'
    when s ~* '(figma|photoshop|illustrator)' then 'design'
    else 'other'
  end
  from (select coalesce(title, '') as t, coalesce(stack::text, '') as s) x
$$;

-- Формат работы: гибрид упоминают в тексте; удалёнка — флаг is_remote; иначе офис, если указан город.
create or replace function public.vacancy_work_format(is_remote boolean, city text, title text, description text)
returns text language sql immutable set search_path = '' as $$
  select case
    when coalesce(title, '') || ' ' || coalesce(description, '') ~* '(гибрид|hybrid)' then 'hybrid'
    when is_remote then 'remote'
    when nullif(trim(city), '') is not null then 'office'
  end
$$;

-- Город к единому написанию: один город (первый из списка), по-русски, без «г.».
create or replace function public.normalize_city(city text)
returns text language sql immutable set search_path = '' as $$
  with first as (
    select nullif(trim(both ' .' from regexp_replace(
             split_part(split_part(split_part(coalesce(city, ''), ',', 1), '/', 1), ';', 1),
             '^(г\.|город)\s*', '', 'i')), '') as c
  )
  select case
    when c is null then null
    when lower(c) in ('москва', 'moscow', 'мск', 'msk') then 'Москва'
    when lower(c) in ('санкт-петербург', 'санкт петербург', 'спб', 'питер', 'петербург', 'saint petersburg',
                      'st. petersburg', 'st petersburg', 'saint-petersburg', 'spb') then 'Санкт-Петербург'
    when lower(c) in ('ташкент', 'toshkent', 'tashkent') then 'Ташкент'
    when lower(c) in ('лимассол', 'лимасол', 'limassol') then 'Лимассол'
    when lower(c) in ('алматы', 'алма-ата', 'almaty') then 'Алматы'
    when lower(c) in ('астана', 'нур-султан', 'astana') then 'Астана'
    when lower(c) in ('минск', 'minsk') then 'Минск'
    when lower(c) in ('ереван', 'yerevan') then 'Ереван'
    when lower(c) in ('тбилиси', 'tbilisi') then 'Тбилиси'
    when lower(c) in ('белград', 'belgrade', 'beograd') then 'Белград'
    when lower(c) in ('варшава', 'warsaw', 'warszawa') then 'Варшава'
    when lower(c) in ('берлин', 'berlin') then 'Берлин'
    when lower(c) in ('дубай', 'dubai') then 'Дубай'
    when lower(c) in ('абу-даби', 'abu dhabi') then 'Абу-Даби'
    when lower(c) in ('барселона', 'barcelona') then 'Барселона'
    when lower(c) in ('лиссабон', 'lisbon') then 'Лиссабон'
    when lower(c) in ('лондон', 'london') then 'Лондон'
    when lower(c) in ('бишкек', 'bishkek') then 'Бишкек'
    when lower(c) in ('баку', 'baku') then 'Баку'
    when lower(c) in ('новосибирск', 'novosibirsk') then 'Новосибирск'
    when lower(c) in ('екатеринбург', 'екб', 'yekaterinburg') then 'Екатеринбург'
    when lower(c) in ('нижний новгород', 'нн', 'nizhny novgorod') then 'Нижний Новгород'
    when lower(c) in ('казань', 'kazan') then 'Казань'
    when lower(c) in ('рф', 'россия', 'russia') then 'Россия'
    else upper(left(c, 1)) || substr(c, 2)
  end
  from first
$$;

alter table public.vacancies
  add column if not exists level text
    constraint vacancies_level_check check (level in ('intern', 'junior', 'middle', 'senior', 'lead')),
  add column if not exists direction text
    constraint vacancies_direction_check check (direction in (
      'backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml', 'analytics', 'security',
      'gamedev', 'design', 'product', 'marketing', 'content', 'sales', 'hr', 'support', 'finance',
      'education', 'other')),
  add column if not exists work_format text
    constraint vacancies_work_format_check check (work_format in ('office', 'hybrid', 'remote')),
  -- Хэш текста поста без ссылок, упоминаний, хэштегов, эмодзи и пробелов: ловит репосты
  -- одной вакансии в разных каналах с косметическими отличиями
  add column if not exists text_fingerprint text,
  -- Название для поиска дублей: «Android-разработчик» = «android разработчик»
  add column if not exists title_key text
    generated always as (btrim(regexp_replace(lower(title), '[^[:alnum:]]+', ' ', 'g'))) stored;

create index if not exists vacancies_direction_idx on public.vacancies (direction) where archived_at is null;
create index if not exists vacancies_level_idx on public.vacancies (level) where archived_at is null;
create index if not exists vacancies_fingerprint_idx on public.vacancies (text_fingerprint);
create index if not exists vacancies_title_key_idx on public.vacancies (title_key) where archived_at is null;

create or replace function public.normalize_vacancy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Название поменяли, а уровень/направление явно не задали — пересчитываем
  if tg_op = 'UPDATE' and new.title is distinct from old.title then
    if new.level is not distinct from old.level then new.level := null; end if;
    if new.direction is not distinct from old.direction then new.direction := null; end if;
  end if;
  if tg_op = 'UPDATE' and (new.is_remote, new.city, new.description) is distinct from (old.is_remote, old.city, old.description)
     and new.work_format is not distinct from old.work_format then
    new.work_format := null;
  end if;
  new.city := public.normalize_city(new.city);
  new.level := coalesce(new.level, public.vacancy_level(new.title, new.description));
  new.direction := coalesce(new.direction, public.vacancy_direction(new.title, new.stack));
  new.work_format := coalesce(new.work_format,
                              public.vacancy_work_format(new.is_remote, new.city, new.title, new.description));
  return new;
end;
$$;

create or replace trigger vacancies_normalize
  before insert or update on public.vacancies
  for each row execute function public.normalize_vacancy();

-- Заполнить старые вакансии (повторный запуск ничего не меняет: значения уже есть)
update public.vacancies
   set city = public.normalize_city(city)
 where direction is null
    or city is distinct from public.normalize_city(city);

-- Дубли из разных каналов: та же должность у той же компании или с тем же контактом
-- в пределах 21 дня. Оставляем первую (раньше опубликованную), остальные — в архив.
update public.vacancies d
   set archived_at = now()
 where d.archived_at is null
   and d.source_type = 'external'
   and exists (
     select 1 from public.vacancies o
      where o.archived_at is null
        and o.id <> d.id
        and o.title_key = d.title_key
        and (
          (o.company_name is not null and lower(o.company_name) = lower(d.company_name))
          or (o.contact_value is not null and lower(o.contact_value) = lower(d.contact_value))
        )
        and abs(extract(epoch from coalesce(o.posted_at, o.created_at) - coalesce(d.posted_at, d.created_at))) < 21 * 86400
        and (coalesce(o.posted_at, o.created_at), o.id) < (coalesce(d.posted_at, d.created_at), d.id)
   );

-- ---------------------------------------------------------------------------
-- Кэш сопроводительных писем
-- ---------------------------------------------------------------------------
-- Повторный клик «Сгенерировать» на той же вакансии с тем же профилем отдаёт
-- готовое письмо без запроса к ИИ и без расхода лимита. input_hash — хэш данных
-- профиля и вакансии вместе с версией промпта: изменился профиль — письмо новое.
create table if not exists public.cover_letters (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  vacancy_id uuid not null references public.vacancies (id) on delete cascade,
  input_hash text not null,
  text       text not null check (char_length(text) <= 4000),
  created_at timestamptz not null default now(),
  unique (user_id, vacancy_id, input_hash)
);

create index if not exists cover_letters_vacancy_idx on public.cover_letters (vacancy_id);

alter table public.cover_letters enable row level security;

-- Только свои письма: читать, сохранять и заменять при «Переписать»
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cover_letters' and policyname = 'cover_letters_select_own') then
    create policy cover_letters_select_own on public.cover_letters
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cover_letters' and policyname = 'cover_letters_insert_own') then
    create policy cover_letters_insert_own on public.cover_letters
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cover_letters' and policyname = 'cover_letters_update_own') then
    create policy cover_letters_update_own on public.cover_letters
      for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Поиск по-русски
-- ---------------------------------------------------------------------------
-- Словоформы: «разработчик» находит «разработчика», «платежи» — «платежей».
-- Латиница в конфигурации russian обрабатывается английским стеммером.
-- Лента ищет и по этому полю, и по подстроке (для «C++», «.NET», «PostgreSQL» по «postgres»).
alter table public.vacancies
  add column if not exists search_tsv tsvector
    generated always as (
      setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('russian', coalesce(company_name, '')), 'B') ||
      setweight(to_tsvector('russian', coalesce(description, '')), 'C')
    ) stored;

create index if not exists vacancies_search_idx on public.vacancies using gin (search_tsv);
