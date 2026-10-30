-- База резюме для работодателей. Кандидат сам открывает профиль работодателям
-- (по умолчанию закрыт — согласие на показ, 152-ФЗ). Работодатель ищет по фильтрам,
-- сохраняет кандидатов и пишет им в чат; контакты кандидата не раскрываются.

alter table public.profiles
  add column if not exists resume_public boolean not null default false,
  add column if not exists resume_headline text,
  add column if not exists resume_published_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_resume_headline_length') then
    alter table public.profiles add constraint profiles_resume_headline_length
      check (char_length(resume_headline) <= 120);
  end if;
end;
$$;

-- Показ резюме — только для кандидатов; время публикации обновляется при открытии
-- и при правке профиля, пока он открыт (база сортирует по свежести)
create or replace function public.profiles_resume_visibility()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from 'candidate' then
    new.resume_public := false;
  end if;
  new.resume_headline := nullif(btrim(new.resume_headline), '');
  if new.resume_public and (tg_op = 'INSERT' or not old.resume_public
      or (new.description, new.skills, new.experience_years, new.pref_level, new.pref_directions, new.pref_formats,
          new.pref_city, new.pref_salary, new.resume_headline, new.resume_path)
         is distinct from
         (old.description, old.skills, old.experience_years, old.pref_level, old.pref_directions, old.pref_formats,
          old.pref_city, old.pref_salary, old.resume_headline, old.resume_path)) then
    new.resume_published_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_resume_visibility() from public, anon, authenticated;

create or replace trigger profiles_resume_visibility
  before insert or update on public.profiles
  for each row execute function public.profiles_resume_visibility();

create index if not exists profiles_resume_board_idx on public.profiles (resume_published_at desc) where resume_public;

-- PDF открытого резюме видят работодатели
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'resumes_board_select') then
    execute $p$
      create policy resumes_board_select on storage.objects for select to authenticated
      using (
        bucket_id = 'resumes'
        and exists (select 1 from public.profiles me where me.id = auth.uid() and me.role = 'employer')
        and exists (select 1 from public.profiles c
                     where c.id::text = (storage.foldername(name))[1] and c.resume_public)
      )
    $p$;
  end if;
end;
$$;

-- Сохранённые работодателем кандидаты
create table if not exists public.resume_marks (
  employer_id  uuid not null references public.profiles (id) on delete cascade,
  candidate_id uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (employer_id, candidate_id)
);
alter table public.resume_marks enable row level security;
revoke all on table public.resume_marks from anon, authenticated;
grant select, insert, delete on table public.resume_marks to authenticated;

drop policy if exists resume_marks_own on public.resume_marks;
create policy resume_marks_own on public.resume_marks
  for all to authenticated
  using (employer_id = (select auth.uid()))
  with check (employer_id = (select auth.uid())
              and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'employer'));

-- Поиск по базе резюме (только работодателям). Слова поиска — все должны встретиться
-- в должности, навыках или описании. for_vacancy — посчитать совпадение с вакансией.
create or replace function public.resume_board(
  search text default null,
  dirs text[] default null,
  lvls text[] default null,
  fmts text[] default null,
  in_city text default null,
  max_salary integer default null,
  min_experience integer default null,
  with_pdf boolean default false,
  only_saved boolean default false,
  for_vacancy uuid default null,
  sort_by text default 'fresh',
  page_size integer default 20,
  page_offset integer default 0)
returns table (id uuid, name text, headline text, about text, skills jsonb, experience_years numeric,
               level text, directions text[], formats text[], city text, salary integer,
               published_at timestamptz, has_pdf boolean, saved boolean, score integer,
               conversation_id uuid, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  v public.vacancies;
  words text[];
begin
  if me is null or (select p.role from public.profiles p where p.id = me) is distinct from 'employer' then
    raise exception 'resume_board: только для работодателей' using errcode = '42501';
  end if;
  if for_vacancy is not null then
    select * into v from public.vacancies x where x.id = for_vacancy and x.employer_id = me;
  end if;
  words := array(select w from regexp_split_to_table(lower(btrim(coalesce(search, ''))), '\s+') w where length(w) > 1 limit 8);
  return query
  with base as (
    select p.id as pid,
           lower(concat_ws(' ', p.resume_headline, p.description,
                           (select string_agg(s, ' ') from jsonb_array_elements_text(
                              case when jsonb_typeof(p.skills) = 'array' then p.skills else '[]'::jsonb end) s))) as hay
      from public.profiles p
     where p.resume_public and p.role = 'candidate' and p.id <> me
  ), filtered as (
    select p.*, case when v.id is not null then (public.vacancy_match(v, p) ->> 'score')::integer end as match
      from base b
      join public.profiles p on p.id = b.pid
     where (cardinality(words) = 0 or (select bool_and(b.hay like '%' || w || '%') from unnest(words) w))
       and (dirs is null or cardinality(dirs) = 0 or p.pref_directions && dirs)
       and (lvls is null or cardinality(lvls) = 0 or p.pref_level = any (lvls))
       and (fmts is null or cardinality(fmts) = 0 or p.pref_formats && fmts
            or (p.pref_format is not null and p.pref_format = any (fmts)))
       and (in_city is null or btrim(in_city) = '' or lower(p.pref_city) = lower(btrim(in_city))
            or 'remote' = any (p.pref_formats))
       and (max_salary is null or p.pref_salary is null or p.pref_salary <= max_salary)
       and (min_experience is null or coalesce(p.experience_years, 0) >= min_experience)
       and (not with_pdf or p.resume_path is not null)
       and (not only_saved or exists (select 1 from public.resume_marks m where m.employer_id = me and m.candidate_id = p.id))
  )
  select f.id, f.name::text, f.resume_headline::text, left(f.description, 700)::text, f.skills, f.experience_years::numeric,
         f.pref_level::text, f.pref_directions::text[], f.pref_formats::text[], f.pref_city::text, f.pref_salary::integer,
         f.resume_published_at, f.resume_path is not null,
         exists (select 1 from public.resume_marks m where m.employer_id = me and m.candidate_id = f.id),
         f.match,
         (select c.id from public.conversations c where c.employer_id = me and c.candidate_id = f.id
           order by c.last_message_at desc limit 1),
         count(*) over ()
    from filtered f
   order by
     case when sort_by = 'match' then f.match end desc nulls last,
     case when sort_by = 'salary' then f.pref_salary end asc nulls last,
     case when sort_by = 'experience' then f.experience_years end desc nulls last,
     f.resume_published_at desc nulls last, f.id
   limit least(greatest(page_size, 1), 50) offset greatest(page_offset, 0);
end;
$$;
revoke all on function public.resume_board(text, text[], text[], text[], text, integer, integer, boolean, boolean, uuid, text, integer, integer) from public, anon;
grant execute on function public.resume_board(text, text[], text[], text[], text, integer, integer, boolean, boolean, uuid, text, integer, integer) to authenticated;

-- Диалог по инициативе работодателя (из базы резюме) — без отклика
alter table public.conversations alter column application_id drop not null;
create unique index if not exists conversations_direct_pair_key
  on public.conversations (employer_id, candidate_id) where application_id is null;

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text', 'application', 'status', 'offer'));

-- Работодатель пишет кандидату из базы резюме. Если диалог с ним уже есть — пишет туда.
-- Новых диалогов — не больше 20 в сутки (защита кандидатов от рассылок).
create or replace function public.start_conversation(candidate uuid, vacancy uuid, body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean text := btrim(coalesce(body, ''));
  vac_id uuid;
  vac_title text;
  conv uuid;
begin
  if me is null or (select role from public.profiles where id = me) is distinct from 'employer' then
    raise exception 'chat: писать из базы резюме могут только работодатели' using errcode = '42501';
  end if;
  if clean = '' then
    raise exception 'chat: напишите сообщение кандидату' using errcode = '22023';
  end if;
  if char_length(clean) > 4000 then
    raise exception 'chat: сообщение длиннее 4000 символов' using errcode = '22023';
  end if;
  if vacancy is not null then
    select x.id, x.title into vac_id, vac_title from public.vacancies x
     where x.id = vacancy and x.employer_id = me and x.archived_at is null;
    if vac_id is null then
      raise exception 'chat: вакансия не найдена среди ваших открытых' using errcode = '22023';
    end if;
  end if;
  select c.id into conv from public.conversations c
   where c.employer_id = me and c.candidate_id = candidate order by c.last_message_at desc limit 1;
  if conv is null then
    if not exists (select 1 from public.profiles where id = candidate and role = 'candidate' and resume_public) then
      raise exception 'chat: кандидат скрыл резюме' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('chat-start:' || me::text, 0));
    if (select count(*) from public.conversations
         where employer_id = me and application_id is null and created_at > now() - interval '1 day') >= 20 then
      raise exception 'chat: на сегодня новых диалогов достаточно — не больше 20 в сутки' using errcode = 'P0001';
    end if;
    insert into public.conversations (application_id, vacancy_id, candidate_id, employer_id, employer_read_at)
    values (null, vac_id, candidate, me, now())
    returning id into conv;
  end if;
  insert into public.messages (conversation_id, sender_id, kind, body, meta)
  values (conv, me, case when vac_id is not null then 'offer' else 'text' end, clean,
          case when vac_id is not null then jsonb_build_object('vacancy_id', vac_id, 'vacancy_title', vac_title)
               else '{}'::jsonb end);
  update public.conversations set employer_read_at = now() where id = conv;
  return conv;
end;
$$;
revoke all on function public.start_conversation(uuid, uuid, text) from public, anon;
grant execute on function public.start_conversation(uuid, uuid, text) to authenticated;

-- Список диалогов: диалог без отклика тоже показываем (статуса у него нет)
create or replace function public.my_conversations()
returns table (id uuid, application_id uuid, vacancy_id uuid, vacancy_title text, other_name text,
               i_am text, status text, last_body text, last_kind text, last_mine boolean,
               last_message_at timestamptz, unread integer, other_read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.application_id, c.vacancy_id,
         coalesce(v.title, case when c.application_id is null then 'Из базы резюме' else 'Вакансия удалена' end),
         case when c.candidate_id = me.uid
              then coalesce(nullif(v.company_name, ''), nullif(e.name, ''), 'Работодатель')
              else coalesce(nullif(p.name, ''), 'Кандидат') end,
         case when c.candidate_id = me.uid then 'candidate' else 'employer' end,
         a.status::text,
         left(last.body, 200), last.kind, last.sender_id = me.uid, c.last_message_at,
         (select count(*)::integer from public.messages m
           where m.conversation_id = c.id and m.sender_id is distinct from me.uid
             and m.created_at > coalesce(case when c.candidate_id = me.uid then c.candidate_read_at
                                              else c.employer_read_at end, '-infinity')),
         case when c.candidate_id = me.uid then c.employer_read_at else c.candidate_read_at end
    from (select auth.uid() as uid) me
    join public.conversations c on me.uid in (c.candidate_id, c.employer_id)
    left join public.applications a on a.id = c.application_id
    left join public.vacancies v on v.id = c.vacancy_id
    left join public.profiles p on p.id = c.candidate_id
    left join public.profiles e on e.id = c.employer_id
    left join lateral (select m.body, m.kind, m.sender_id from public.messages m
                        where m.conversation_id = c.id order by m.id desc limit 1) last on true
   order by c.last_message_at desc
   limit 200
$$;

-- Аудит безопасности знает про функции базы резюме
create or replace function public.security_audit()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  -- Функции SECURITY DEFINER, которые сайт осознанно вызывает без входа
  anon_ok(name) as (values ('link_telegram_chat'), ('live_stats'), ('rate_interview'), ('register_vacancy_view')),
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
