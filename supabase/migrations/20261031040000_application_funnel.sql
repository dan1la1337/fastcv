-- Прозрачность воронки для кандидата: где его отклик среди других (по времени и по
-- совпадению — работодатель по умолчанию сортирует по совпадению), сколько откликов
-- работодатель уже открыл, когда заходил и как быстро обычно отвечает. Только
-- агрегаты: о других кандидатах — ни имён, ни отдельных значений.

create or replace function public.my_application_funnel()
returns table (application_id uuid, total integer, place_in_line integer, match_score integer, match_rank integer,
               better_than integer, viewed integer, answered integer, employer_active_at timestamptz,
               reply_hours integer, reply_rate integer)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select a.id, a.vacancy_id, a.created_at, v.employer_id
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
     where a.candidate_id = (select auth.uid()) and v.employer_id is not null and a.candidate_id <> v.employer_id
  ),
  peers as (
    select a.id, a.vacancy_id, a.created_at, a.viewed_at, a.answered_at,
           coalesce((public.vacancy_match(v, p) ->> 'score')::int, 0) as score
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
      join public.profiles p on p.id = a.candidate_id
     where a.vacancy_id in (select vacancy_id from mine) and a.candidate_id is distinct from v.employer_id
  ),
  ranked as (
    select p.*, count(*) over w as total,
           row_number() over (partition by p.vacancy_id order by p.created_at, p.id) as pos,
           rank() over (partition by p.vacancy_id order by p.score desc) as match_rank,
           count(p.viewed_at) over w as viewed, count(p.answered_at) over w as answered
      from peers p
    window w as (partition by p.vacancy_id)
  ),
  employers as (
    -- Как работодатель отвечает: те же 90 дней и порог данных, что в рейтинге компании
    select v.employer_id,
           count(*) as n, count(a.answered_at) as answered,
           percentile_cont(0.5) within group (order by extract(epoch from a.answered_at - a.created_at)) / 3600 as hours,
           max(greatest(a.viewed_at, a.answered_at)) as active_at
      from public.applications a
      join public.vacancies v on v.id = a.vacancy_id
     where v.employer_id in (select employer_id from mine) and a.candidate_id is distinct from v.employer_id
       and a.created_at > now() - interval '90 days'
     group by v.employer_id
  )
  select m.id, r.total::int, r.pos::int, r.score, r.match_rank::int,
         -- доля других откликов с меньшим совпадением — только когда откликов достаточно
         case when r.total >= 5 then
           round(100.0 * (select count(*) from peers o where o.vacancy_id = m.vacancy_id and o.score < r.score) / (r.total - 1))::int end,
         r.viewed::int, r.answered::int, e.active_at,
         case when e.n >= 5 and e.answered > 0 then greatest(1, round(e.hours))::int end,
         case when e.n >= 5 then round(100.0 * e.answered / e.n)::int end
    from mine m
    join ranked r on r.id = m.id
    left join employers e on e.employer_id = m.employer_id
$$;
revoke all on function public.my_application_funnel() from public, anon;
grant execute on function public.my_application_funnel() to authenticated;

-- Аудит безопасности знает про воронку кандидата
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
    -- запись на собеседование: только участники диалога
    ('propose_interview_slots'), ('book_interview_slot'), ('cancel_interview_slot'), ('my_upcoming_interviews'),
    -- воронка: только свои отклики, о других — агрегаты
    ('my_application_funnel'),
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
