-- Служебные поля profiles (#141), шаг 1 из 2: то, на что переходит сайт. Ничего не
-- закрывает и совместимо со старой версией сайта. Колонки закрывает шаг 2
-- (20261118015000_profiles_private_columns_revoke.sql), его применяют после выката сайта.

-- Работодателю достаточно знать, что PDF есть: путь всегда <id кандидата>/resume.pdf
alter table public.profiles
  add column if not exists has_resume boolean generated always as (resume_path is not null) stored;

-- Служебные поля своего профиля
create or replace function public.my_private_profile()
returns table (resume_path text, telegram_chat_id bigint, company_verify_token text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.resume_path, p.telegram_chat_id, p.company_verify_token
    from public.profiles p
   where p.id = (select auth.uid())
$$;
revoke execute on function public.my_private_profile() from public, anon;
grant execute on function public.my_private_profile() to authenticated;

-- Эти функции передают в vacancy_match строку profiles целиком, а это чтение всех её
-- колонок. Каждая сама ограничивает выборку auth.uid() (свой профиль; отклики на свои
-- вакансии), поэтому выполняются с правами владельца, как остальные функции подборки.
alter function public.my_application_matches() security definer;
alter function public.my_vacancy_matches(uuid[]) security definer;
alter function public.recommended_vacancies(integer, integer) security definer;

-- Новые функции для вошедших — в список осознанных исключений аудита
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
    -- служебные поля своего профиля — только владельцу
    ('my_private_profile'),
    -- PDF открытого резюме: только работодателю и только флаг (20261118013000)
    ('resume_pdf_is_public'),
    -- воронка: только свои отклики, о других — агрегаты
    ('my_application_funnel'),
    -- функции подборки и совпадения: только данные самого пользователя
    ('my_application_matches'), ('my_vacancy_matches'), ('recommended_vacancies')),
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
