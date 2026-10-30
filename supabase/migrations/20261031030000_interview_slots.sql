-- Запись на собеседование по слотам: работодатель в чате предлагает до 6 вариантов
-- времени, кандидат выбирает один — обоим приходит сообщение и событие для календаря,
-- накануне — напоминание (сборщик, Telegram или письмо). Перенос — новое предложение,
-- отмена — любой из участников. Писать — только функциями ниже, читать — участникам.

create table if not exists public.interview_slots (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  employer_id     uuid not null references public.profiles (id) on delete cascade,
  candidate_id    uuid not null references public.profiles (id) on delete cascade,
  starts_at       timestamptz not null,
  duration_min    smallint not null check (duration_min between 15 and 240),
  -- ссылка на звонок или адрес
  place           text check (char_length(place) <= 300),
  -- open — можно выбрать; booked — выбран; withdrawn — заменён другим; cancelled — отменён
  status          text not null default 'open' check (status in ('open', 'booked', 'withdrawn', 'cancelled')),
  booked_at       timestamptz,
  reminded_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists interview_slots_conversation_idx on public.interview_slots (conversation_id, starts_at);
create index if not exists interview_slots_upcoming_idx on public.interview_slots (starts_at) where status = 'booked';
create index if not exists interview_slots_candidate_idx on public.interview_slots (candidate_id) where status = 'booked';
create index if not exists interview_slots_employer_idx on public.interview_slots (employer_id) where status = 'booked';

alter table public.interview_slots enable row level security;
revoke all on table public.interview_slots from anon, authenticated;
grant select on table public.interview_slots to authenticated;
drop policy if exists interview_slots_participant_select on public.interview_slots;
create policy interview_slots_participant_select on public.interview_slots
  for select to authenticated
  using ((select auth.uid()) in (candidate_id, employer_id));

-- slots — предложение времени, booking — запись или отмена
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'application', 'status', 'offer', 'slots', 'booking'));

-- «3 ноября, 15:00 МСК» — для текста сообщений и напоминаний
create or replace function public.interview_time_label(t timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select extract(day from t at time zone 'Europe/Moscow')::int || ' '
         || (array['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'])
            [extract(month from t at time zone 'Europe/Moscow')::int]
         || ', ' || to_char(t at time zone 'Europe/Moscow', 'HH24:MI') || ' МСК'
$$;

-- Предложить время. Прежние невыбранные варианты заменяются; если кандидат ещё не
-- приглашён — предложение и есть приглашение (статус отклика меняется).
create or replace function public.propose_interview_slots(conversation uuid, starts timestamptz[], duration integer, place text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c record;
  clean_place text := nullif(btrim(coalesce(place, '')), '');
  times timestamptz[];
  ids uuid[];
  m public.messages;
begin
  select id, candidate_id, employer_id, application_id into c from public.conversations where id = conversation;
  if uid is null or c.id is null or uid is distinct from c.employer_id then
    raise exception 'slots: диалог не найден' using errcode = '42501';
  end if;
  select array_agg(distinct t order by t) into times from unnest(starts) t where t is not null;
  if coalesce(cardinality(times), 0) = 0 or cardinality(times) > 6 then
    raise exception 'slots: предложите от 1 до 6 вариантов времени' using errcode = '22023';
  end if;
  if times[1] < now() + interval '30 minutes' or times[cardinality(times)] > now() + interval '60 days' then
    raise exception 'slots: время — не раньше чем через полчаса и не позже чем через 60 дней' using errcode = '22023';
  end if;
  if duration is null or duration not between 15 and 240 then
    raise exception 'slots: длительность от 15 минут до 4 часов' using errcode = '22023';
  end if;
  if char_length(clean_place) > 300 then
    raise exception 'slots: ссылка или адрес длиннее 300 символов' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('slots:' || uid::text, 0));
  if (select count(*) from public.messages
       where sender_id = uid and kind = 'slots' and created_at > now() - interval '1 day') >= 50 then
    raise exception 'slots: слишком много предложений за сутки' using errcode = 'P0001';
  end if;

  -- Ещё не приглашён — приглашаем (сообщение о приглашении придёт раньше вариантов времени)
  if c.application_id is not null then
    update public.applications
       set status = 'interview_scheduled',
           hr_message = coalesce(nullif(btrim(hr_message), ''), 'Приглашаем вас на собеседование — выберите удобное время в чате.')
     where id = c.application_id and status in ('new', 'viewed');
  end if;

  update public.interview_slots set status = 'withdrawn' where conversation_id = c.id and status = 'open';
  with ins as (
    insert into public.interview_slots (conversation_id, employer_id, candidate_id, starts_at, duration_min, place)
    select c.id, c.employer_id, c.candidate_id, t, duration, clean_place from unnest(times) t
    returning id, starts_at
  )
  select array_agg(id order by starts_at) into ids from ins;

  insert into public.messages (conversation_id, sender_id, kind, body, meta)
  values (c.id, uid, 'slots',
          'Предлагаю время собеседования: ' || (select string_agg(public.interview_time_label(t), '; ' order by t) from unnest(times) t)
            || '. Выберите удобный вариант.',
          jsonb_build_object('slot_ids', to_jsonb(ids), 'duration', duration, 'place', clean_place))
  returning * into m;
  update public.conversations set employer_read_at = now() where id = c.id;
  return to_jsonb(m);
end;
$$;
revoke all on function public.propose_interview_slots(uuid, timestamptz[], integer, text) from public, anon;
grant execute on function public.propose_interview_slots(uuid, timestamptz[], integer, text) to authenticated;

-- Кандидат выбирает вариант. Остальные варианты и прежняя запись (перенос) снимаются.
create or replace function public.book_interview_slot(slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.interview_slots;
  m public.messages;
begin
  select * into s from public.interview_slots where id = slot for update;
  if uid is null or s.id is null or uid is distinct from s.candidate_id then
    raise exception 'slots: вариант не найден' using errcode = '42501';
  end if;
  if s.status <> 'open' then
    raise exception 'slots: этот вариант уже недоступен — обновите чат' using errcode = '22023';
  end if;
  if s.starts_at < now() + interval '15 minutes' then
    raise exception 'slots: это время уже прошло — попросите работодателя предложить другое' using errcode = '22023';
  end if;
  update public.interview_slots set status = 'withdrawn' where conversation_id = s.conversation_id and status = 'open' and id <> s.id;
  update public.interview_slots set status = 'cancelled'
   where conversation_id = s.conversation_id and status = 'booked' and starts_at > now();
  update public.interview_slots set status = 'booked', booked_at = now() where id = s.id;

  insert into public.messages (conversation_id, sender_id, kind, body, meta)
  values (s.conversation_id, uid, 'booking',
          'Записался на собеседование: ' || public.interview_time_label(s.starts_at) || '.',
          jsonb_build_object('slot_id', s.id, 'action', 'booked', 'starts_at', s.starts_at,
                             'duration', s.duration_min, 'place', s.place))
  returning * into m;
  update public.conversations set candidate_read_at = now() where id = s.conversation_id;
  return to_jsonb(m);
end;
$$;
revoke all on function public.book_interview_slot(uuid) from public, anon;
grant execute on function public.book_interview_slot(uuid) to authenticated;

-- Отмена записи любым участником (до начала). Причина — по желанию.
create or replace function public.cancel_interview_slot(slot uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.interview_slots;
  why text := nullif(left(btrim(coalesce(reason, '')), 500), '');
  m public.messages;
begin
  select * into s from public.interview_slots where id = slot for update;
  if uid is null or s.id is null or uid not in (s.candidate_id, s.employer_id) then
    raise exception 'slots: запись не найдена' using errcode = '42501';
  end if;
  if s.status <> 'booked' or s.starts_at < now() then
    raise exception 'slots: отменить можно только будущую запись' using errcode = '22023';
  end if;
  update public.interview_slots set status = 'cancelled' where id = s.id;
  insert into public.messages (conversation_id, sender_id, kind, body, meta)
  values (s.conversation_id, uid, 'booking',
          'Собеседование ' || public.interview_time_label(s.starts_at) || ' отменено.' || coalesce(' Причина: ' || why, ''),
          jsonb_build_object('slot_id', s.id, 'action', 'cancelled', 'starts_at', s.starts_at,
                             'duration', s.duration_min, 'place', s.place, 'reason', why))
  returning * into m;
  update public.conversations
     set candidate_read_at = case when uid = s.candidate_id then now() else candidate_read_at end,
         employer_read_at  = case when uid = s.employer_id then now() else employer_read_at end
   where id = s.conversation_id;
  return to_jsonb(m);
end;
$$;
revoke all on function public.cancel_interview_slot(uuid, text) from public, anon;
grant execute on function public.cancel_interview_slot(uuid, text) to authenticated;

-- Ближайшие собеседования пользователя (кандидата или работодателя)
create or replace function public.my_upcoming_interviews()
returns table (slot_id uuid, conversation_id uuid, application_id uuid, i_am text, other_name text,
               vacancy_title text, starts_at timestamptz, duration_min smallint, place text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.conversation_id, c.application_id,
         case when s.candidate_id = (select auth.uid()) then 'candidate' else 'employer' end,
         case when s.candidate_id = (select auth.uid())
              then coalesce(nullif(v.company_name, ''), nullif(e.name, ''), 'Работодатель')
              else coalesce(nullif(p.name, ''), 'Кандидат') end,
         coalesce(v.title, 'Собеседование'), s.starts_at, s.duration_min, s.place
    from public.interview_slots s
    join public.conversations c on c.id = s.conversation_id
    left join public.vacancies v on v.id = c.vacancy_id
    left join public.profiles e on e.id = s.employer_id
    left join public.profiles p on p.id = s.candidate_id
   where s.status = 'booked' and s.starts_at + make_interval(mins => s.duration_min) > now()
     and (select auth.uid()) in (s.candidate_id, s.employer_id)
   order by s.starts_at
   limit 50
$$;
revoke all on function public.my_upcoming_interviews() from public, anon;
grant execute on function public.my_upcoming_interviews() to authenticated;

-- Напоминания накануне (вызывает сборщик раз в 2 часа): запись в ближайшие сутки,
-- но не раньше чем через полчаса. Обеим сторонам — по строке.
create or replace function public.pending_interview_reminders()
returns table (slot_id uuid, conversation_id uuid, side text, email text, telegram_chat_id bigint,
               other_name text, vacancy_title text, starts_at timestamptz, when_label text,
               duration_min smallint, place text)
language sql
stable
security definer
set search_path = ''
as $$
  with due as (
    select s.*, c.vacancy_id from public.interview_slots s
      join public.conversations c on c.id = s.conversation_id
     where s.status = 'booked' and s.reminded_at is null
       and s.starts_at between now() + interval '30 minutes' and now() + interval '24 hours'
  ),
  sides as (
    select d.*, 'candidate' as side, d.candidate_id as uid,
           coalesce(nullif(v.company_name, ''), nullif(e.name, ''), 'Работодатель') as other
      from due d left join public.vacancies v on v.id = d.vacancy_id left join public.profiles e on e.id = d.employer_id
    union all
    select d.*, 'employer', d.employer_id, coalesce(nullif(p.name, ''), 'Кандидат')
      from due d left join public.profiles p on p.id = d.candidate_id
  )
  select s.id, s.conversation_id, s.side, u.email::text, pr.telegram_chat_id, s.other,
         coalesce(v.title, 'вакансия'), s.starts_at, public.interview_time_label(s.starts_at), s.duration_min, s.place
    from sides s
    join auth.users u on u.id = s.uid
    join public.profiles pr on pr.id = s.uid
    left join public.vacancies v on v.id = s.vacancy_id
   order by s.starts_at
   limit 200
$$;
revoke all on function public.pending_interview_reminders() from public, anon, authenticated;
grant execute on function public.pending_interview_reminders() to service_role;

create or replace function public.mark_interview_reminded(slot uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.interview_slots set reminded_at = now() where id = slot
$$;
revoke all on function public.mark_interview_reminded(uuid) from public, anon, authenticated;
grant execute on function public.mark_interview_reminded(uuid) to service_role;

-- Аудит безопасности знает про функции записи на собеседование
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
