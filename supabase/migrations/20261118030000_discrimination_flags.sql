-- Дискриминационные требования в вакансиях (ст. 3 и 64 ТК РФ, ст. 13.11.1 КоАП РФ).
--
-- discrimination_flags — что нашли правила discrimination-rules.json в тексте вакансии:
-- age, sex, nationality, citizenship. Пишут сборщик (service_role) и страница работодателя.
-- Вакансии с age, sex или nationality не показываются в публичной ленте и на страницах
-- вакансий. Их видят только автор и кандидаты, которые уже откликнулись. Гражданство
-- (citizenship) только помечается: для части работ его требует закон.
-- Список скрывающих флагов — те, у которых "block": true в discrimination-rules.json.

alter table public.vacancies
  add column if not exists discrimination_flags text[] not null default '{}';

-- Откликнулся ли текущий пользователь на вакансию. security definer: политика applications_select
-- сама читает vacancies, и прямой подзапрос из политики vacancies дал бы бесконечную рекурсию.
create or replace function public.applied_to_vacancy(vacancy uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.applications a
     where a.vacancy_id = vacancy and a.candidate_id = (select auth.uid())
  );
$$;
revoke execute on function public.applied_to_vacancy(uuid) from public;
grant execute on function public.applied_to_vacancy(uuid) to anon, authenticated;

-- Ограничивающая политика: складывается с vacancies_select через И
drop policy if exists vacancies_hide_discriminatory on public.vacancies;
create policy vacancies_hide_discriminatory on public.vacancies
  as restrictive
  for select to anon, authenticated
  using (
    not (discrimination_flags && array['age', 'sex', 'nationality']::text[])
    or employer_id = (select auth.uid())
    or public.applied_to_vacancy(id)
  );

-- Аудит безопасности знает про applied_to_vacancy
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
                          ('company_rating'),
                          -- политика vacancies_hide_discriminatory: только «откликнулся ли я», без входа всегда false
                          ('applied_to_vacancy')),
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
    ('my_application_matches'), ('my_vacancy_matches'),
    -- политика vacancies_hide_discriminatory: проверяет только свой отклик
    ('applied_to_vacancy'),
    -- из параллельных веток (sec/profiles-private-columns, sec/resume-board-pdf): эта миграция
    -- позже по времени и заменяет функцию целиком, поэтому их исключения повторены здесь
    ('my_private_profile'), ('resume_pdf_is_public'), ('recommended_vacancies')),
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
