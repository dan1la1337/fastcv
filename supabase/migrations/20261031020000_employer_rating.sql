-- Рейтинг работодателя (следующий уровень после значков 1.13): отзывы о процессе найма
-- только от кандидатов с реальным откликом, публичный ответ компании, ИИ-выжимка отзывов
-- (пишет сборщик) и итоговый балл из нескольких сигналов на странице компании.

create table if not exists public.hiring_reviews (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications (id) on delete cascade,
  employer_id    uuid not null references public.profiles (id) on delete cascade,
  candidate_id   uuid not null references public.profiles (id) on delete cascade,
  -- до чего дошёл кандидат: откликнулся / прошёл собеседование
  stage          text not null check (stage in ('applied', 'interview')),
  rating         smallint not null check (rating between 1 and 5),
  pros           text check (char_length(pros) <= 1000),
  cons           text check (char_length(cons) <= 1000),
  hidden         boolean not null default false,       -- скрыт модерацией
  reply          text check (char_length(reply) <= 1500),
  replied_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists hiring_reviews_employer_idx on public.hiring_reviews (employer_id, created_at desc);
alter table public.hiring_reviews enable row level security;
revoke all on table public.hiring_reviews from anon, authenticated;

-- ИИ-выжимка отзывов по работодателю (пишет сборщик, читает company_rating)
create table if not exists public.review_summaries (
  employer_id   uuid primary key references public.profiles (id) on delete cascade,
  summary       text not null check (char_length(summary) <= 1500),
  reviews_count integer not null,
  updated_at    timestamptz not null default now()
);
alter table public.review_summaries enable row level security;
revoke all on table public.review_summaries from anon, authenticated;

-- Отзыв о найме: только по своему отклику на вакансию работодателя с FastCV, когда есть
-- что оценить — работодатель ответил или молчит больше 10 дней. Повторный — правка.
create or replace function public.save_hiring_review(application uuid, rating integer, pros text, cons text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  a record;
  rid uuid;
begin
  if rating is null or rating not between 1 and 5 then
    raise exception 'review: оценка от 1 до 5' using errcode = '22023';
  end if;
  select ap.id, ap.candidate_id, ap.status, ap.answered_at, ap.created_at, v.employer_id into a
    from public.applications ap join public.vacancies v on v.id = ap.vacancy_id
   where ap.id = application;
  if a.id is null or a.candidate_id is distinct from me or a.employer_id is null then
    raise exception 'review: отклик не найден' using errcode = '42501';
  end if;
  if a.answered_at is null and a.created_at > now() - interval '10 days' then
    raise exception 'review: отзыв можно оставить после ответа работодателя или через 10 дней без ответа' using errcode = '22023';
  end if;
  insert into public.hiring_reviews (application_id, employer_id, candidate_id, stage, rating, pros, cons)
  values (a.id, a.employer_id, me, case when a.status = 'interview_scheduled' then 'interview' else 'applied' end,
          rating, nullif(left(btrim(pros), 1000), ''), nullif(left(btrim(cons), 1000), ''))
  on conflict (application_id) do update
     set rating = excluded.rating, pros = excluded.pros, cons = excluded.cons, stage = excluded.stage, updated_at = now()
  returning id into rid;
  return rid;
end;
$$;
revoke all on function public.save_hiring_review(uuid, integer, text, text) from public, anon;
grant execute on function public.save_hiring_review(uuid, integer, text, text) to authenticated;

-- Свои отзывы кандидата — для страницы «Мои отклики»
create or replace function public.my_hiring_reviews()
returns table (application_id uuid, rating smallint, pros text, cons text, reply text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.application_id, r.rating, r.pros, r.cons, r.reply
    from public.hiring_reviews r where r.candidate_id = (select auth.uid())
$$;
revoke all on function public.my_hiring_reviews() from public, anon;
grant execute on function public.my_hiring_reviews() to authenticated;

-- Отзывы о работодателе — ему в кабинет (анонимно: без имени кандидата)
create or replace function public.employer_reviews()
returns table (id uuid, vacancy_title text, stage text, rating smallint, pros text, cons text,
               reply text, created_at timestamptz, hidden boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, v.title, r.stage, r.rating, r.pros, r.cons, r.reply, r.created_at, r.hidden
    from public.hiring_reviews r
    join public.applications a on a.id = r.application_id
    left join public.vacancies v on v.id = a.vacancy_id
   where r.employer_id = (select auth.uid())
   order by r.created_at desc
   limit 200
$$;
revoke all on function public.employer_reviews() from public, anon;
grant execute on function public.employer_reviews() to authenticated;

-- Публичный ответ компании на отзыв (пустой — убрать ответ)
create or replace function public.reply_hiring_review(review uuid, reply text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := nullif(btrim(coalesce(reply, '')), '');
begin
  if char_length(clean) > 1500 then
    raise exception 'review: ответ длиннее 1500 символов' using errcode = '22023';
  end if;
  update public.hiring_reviews
     set reply = clean, replied_at = case when clean is null then null else now() end
   where id = review and employer_id = (select auth.uid());
  if not found then
    raise exception 'review: отзыв не найден' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.reply_hiring_review(uuid, text) from public, anon;
grant execute on function public.reply_hiring_review(uuid, text) to authenticated;

-- Рейтинг компании для её страницы (открыт всем). Работодатели компании — профили с её
-- вакансиями на FastCV. Части балла считаются только при достаточных данных; балл — если
-- частей хотя бы две. Отзывы — анонимные: уровень и направление кандидата вместо имени.
create or replace function public.company_rating(company text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with emp as (
    select distinct v.employer_id as id
      from public.vacancies v
     where v.employer_id is not null and lower(v.company_name) = lower(btrim(company))
    union
    select p.id from public.profiles p where p.role = 'employer' and lower(p.name) = lower(btrim(company))
  ),
  apps as (
    select a.created_at, a.answered_at
      from public.applications a join public.vacancies v on v.id = a.vacancy_id
     where v.employer_id in (select id from emp) and a.candidate_id is distinct from v.employer_id
       and a.created_at between now() - interval '90 days' and now() - interval '3 days'
  ),
  replies as (
    select count(*) as total, count(answered_at) as answered,
           percentile_cont(0.5) within group (order by extract(epoch from answered_at - created_at)) / 3600 as hours,
           count(*) filter (where created_at > now() - interval '33 days') as recent_total,
           count(answered_at) filter (where created_at > now() - interval '33 days') as recent_answered
      from apps
  ),
  interviews as (
    select count(*) as n, avg(f.rating) as avg
      from public.interview_feedback f
      join public.applications a on a.id = f.application_id
      join public.vacancies v on v.id = a.vacancy_id
     where v.employer_id in (select id from emp) and f.rating is not null and f.rated_at > now() - interval '365 days'
  ),
  revs as (
    select r.* from public.hiring_reviews r where r.employer_id in (select id from emp) and not r.hidden
  ),
  rev as (
    select count(*) as n, avg(rating) as avg,
           jsonb_build_array(count(*) filter (where rating = 1), count(*) filter (where rating = 2),
                             count(*) filter (where rating = 3), count(*) filter (where rating = 4),
                             count(*) filter (where rating = 5)) as dist
      from revs
  ),
  ghosts as (
    select count(*) as open, count(*) filter (where v.closed_reports > 0) as reported
      from public.vacancies v where v.employer_id in (select id from emp) and v.archived_at is null
  ),
  parts as (
    select
      case when r.total >= 5 then r.answered::numeric / r.total end as reply_rate,
      case when r.total >= 5 and r.answered > 0 then greatest(0, least(1, (240 - r.hours) / 216)) end as speed,
      case when i.n >= 3 then (i.avg - 1) / 4 end as interview,
      case when rv.n >= 3 then (rv.avg - 1) / 4 end as reviews,
      case when g.open >= 1 then 1 - g.reported::numeric / g.open end as fresh,
      r.*, i.n as i_n, i.avg as i_avg, rv.n as rv_n, rv.avg as rv_avg, rv.dist, g.open, g.reported
      from replies r, interviews i, rev rv, ghosts g
  ),
  scored as (
    select p.*,
           (case when reply_rate is not null then 1 else 0 end + case when speed is not null then 1 else 0 end
            + case when interview is not null then 1 else 0 end + case when reviews is not null then 1 else 0 end) as signals,
           (coalesce(reply_rate * 0.30, 0) + coalesce(speed * 0.15, 0) + coalesce(interview * 0.20, 0)
            + coalesce(reviews * 0.25, 0) + coalesce(fresh * 0.10, 0))
           / nullif(case when reply_rate is not null then 0.30 else 0 end + case when speed is not null then 0.15 else 0 end
                    + case when interview is not null then 0.20 else 0 end + case when reviews is not null then 0.25 else 0 end
                    + case when fresh is not null then 0.10 else 0 end, 0) as raw
      from parts p
  )
  select case when not exists (select 1 from emp) then null else jsonb_strip_nulls(jsonb_build_object(
    'score', case when s.signals >= 2 then round(100 * s.raw)::int end,
    'verified', exists (select 1 from public.profiles p where p.id in (select id from emp) and p.company_verified_at is not null),
    'reply_rate', case when s.reply_rate is not null then round(100 * s.reply_rate)::int end,
    'reply_hours', case when s.speed is not null then greatest(1, round(s.hours))::int end,
    'reply_trend', case when s.recent_total >= 5 and s.total - s.recent_total >= 5 then
                     round(100.0 * s.recent_answered / s.recent_total - 100.0 * (s.answered - s.recent_answered) / (s.total - s.recent_total))::int end,
    'applications', s.total,
    'interview_rating', case when s.i_n >= 3 then round(s.i_avg, 1) end,
    'interview_ratings', case when s.i_n >= 3 then s.i_n end,
    'review_rating', case when s.rv_n >= 1 then round(s.rv_avg, 1) end,
    'reviews_count', s.rv_n,
    'distribution', case when s.rv_n >= 1 then s.dist end,
    'open_vacancies', s.open,
    'reported_vacancies', s.reported,
    'summary', (select rs.summary from public.review_summaries rs where rs.employer_id in (select id from emp)
                 order by rs.reviews_count desc limit 1),
    'reviews', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
                  select r.id, r.stage, r.rating, r.pros, r.cons, r.reply, r.replied_at, r.created_at,
                         nullif(concat_ws(', ', case p.pref_level when 'intern' then 'стажёр' when 'junior' then 'junior'
                                                    when 'middle' then 'middle' when 'senior' then 'senior' when 'lead' then 'lead' end,
                                          v.title), '') as who
                    from revs r
                    left join public.profiles p on p.id = r.candidate_id
                    left join public.applications a on a.id = r.application_id
                    left join public.vacancies v on v.id = a.vacancy_id
                   order by r.created_at desc limit 30) x)
  )) end
    from scored s
$$;
revoke all on function public.company_rating(text) from public;
grant execute on function public.company_rating(text) to anon, authenticated;

-- Очередь выжимок для сборщика: от 3 отзывов, выжимки нет или отзывов стало больше
create or replace function public.pending_review_summaries()
returns table (employer_id uuid, company text, reviews jsonb, reviews_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.employer_id, coalesce(nullif(p.name, ''), 'Компания'),
         jsonb_agg(jsonb_build_object('rating', r.rating, 'stage', r.stage, 'pros', r.pros, 'cons', r.cons)
                   order by r.created_at desc),
         count(*)::integer
    from public.hiring_reviews r
    join public.profiles p on p.id = r.employer_id
   where not r.hidden
   group by r.employer_id, p.name
  having count(*) >= 3
     and count(*) is distinct from (select s.reviews_count from public.review_summaries s where s.employer_id = r.employer_id)
   limit 50
$$;
revoke all on function public.pending_review_summaries() from public, anon, authenticated;
grant execute on function public.pending_review_summaries() to service_role;

create or replace function public.save_review_summary(employer uuid, summary text, reviews_count integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.review_summaries (employer_id, summary, reviews_count, updated_at)
  values (employer, left(summary, 1500), reviews_count, now())
  on conflict (employer_id) do update
     set summary = excluded.summary, reviews_count = excluded.reviews_count, updated_at = now()
$$;
revoke all on function public.save_review_summary(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.save_review_summary(uuid, text, integer) to service_role;

-- Аудит безопасности знает про функции рейтинга
create or replace function public.security_audit()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  -- Функции SECURITY DEFINER, которые сайт осознанно вызывает без входа
  anon_ok(name) as (values ('link_telegram_chat'), ('live_stats'), ('rate_interview'), ('register_vacancy_view'),
                          -- рейтинг компании: только сводка и анонимные отзывы
                          ('company_rating')),
  -- … и после входа (каждая сама проверяет auth.uid() и роль)
  auth_ok(name) as (values
    ('admin_metrics'), ('app_user_role'), ('check_company_verification'), ('consume_ai_quota'),
    ('create_telegram_link_code'), ('delete_my_account'), ('exclude_channel'), ('excluded_channels'),
    ('is_app_admin'), ('link_telegram_chat'), ('live_stats'), ('my_closed_report'), ('my_interview_ratings'),
    ('rate_interview'), ('rate_my_interview'), ('register_vacancy_view'), ('report_vacancy_closed'),
    ('set_telegram_bot'), ('start_company_verification'), ('unlink_telegram'),
    -- чат: каждая функция проверяет, что пользователь — участник диалога
    ('send_message'), ('mark_conversation_read'), ('my_conversations'), ('unread_conversations'),
    -- база резюме: только работодателям, проверка роли внутри
    ('resume_board'), ('start_conversation'),
    -- рейтинг работодателя: отзыв по своему отклику, ответ — только на отзывы о себе
    ('company_rating'), ('save_hiring_review'), ('my_hiring_reviews'), ('employer_reviews'), ('reply_hiring_review'),
    -- функции подборки и совпадения: только данные самого пользователя
    ('my_application_matches'), ('my_vacancy_matches')),
  -- Материализованные представления с публичными сводками (без персональных данных)
  matview_ok(name) as (values ('direction_counts'), ('salary_benchmarks'), ('vacancy_cities'), ('vacancy_countries')),
  fns as (
    select p.oid, p.proname, p.prosecdef, p.proconfig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
  ),
  findings(kind, name, detail) as (
    select 'no_rls', c.relname::text, 'таблица без RLS: доступна через API без правил'
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    union all
    select 'anon_definer', f.proname::text, 'SECURITY DEFINER функция доступна без входа'
      from fns f
     where f.prosecdef and pg_catalog.has_function_privilege('anon', f.oid, 'execute')
       and f.proname not in (select name from anon_ok)
    union all
    select 'auth_definer', f.proname::text, 'SECURITY DEFINER функция доступна любому вошедшему'
      from fns f
     where f.prosecdef and pg_catalog.has_function_privilege('authenticated', f.oid, 'execute')
       and f.proname not in (select name from auth_ok)
    union all
    select 'search_path', f.proname::text, 'у функции не зафиксирован search_path'
      from fns f
     where not exists (select 1 from pg_catalog.unnest(coalesce(f.proconfig, '{}')) c where c like 'search_path=%')
    union all
    select 'matview_api', c.relname::text, 'материализованное представление читается через API'
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'm'
       and (pg_catalog.has_table_privilege('anon', c.oid, 'select') or pg_catalog.has_table_privilege('authenticated', c.oid, 'select'))
       and c.relname not in (select name from matview_ok)
    union all
    select 'definer_view', c.relname::text, 'представление работает с правами владельца (нет security_invoker)'
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and not coalesce((select bool_or(o in ('security_invoker=true', 'security_invoker=on'))
                           from pg_catalog.unnest(c.reloptions) o), false)
    union all
    select 'extension_public', e.extname::text, 'расширение в схеме public'
      from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
     where n.nspname = 'public'
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'name', name, 'detail', detail) order by kind, name), '[]'::jsonb)
    from findings
$$;
revoke all on function public.security_audit() from public, anon, authenticated;
grant execute on function public.security_audit() to service_role;
