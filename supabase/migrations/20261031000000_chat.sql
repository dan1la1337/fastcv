-- Чат кандидата и работодателя. Один диалог на отклик: отклик на вакансию работодателя
-- с FastCV открывает диалог, первым сообщением — сам отклик (письмо и ответы на вопросы
-- блица); приглашение или отказ из кабинета тоже приходят в диалог. Вакансии из Telegram
-- и с других сайтов без работодателя на FastCV — без чата.
--
-- Писать и отмечать прочитанное — только функциями ниже (проверка участника, лимит
-- частоты, обновление диалога); читать — напрямую, по правилам доступа.

create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid not null unique references public.applications (id) on delete cascade,
  vacancy_id       uuid references public.vacancies (id) on delete set null,
  candidate_id     uuid not null references public.profiles (id) on delete cascade,
  employer_id      uuid not null references public.profiles (id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  candidate_read_at timestamptz,
  employer_read_at  timestamptz,
  -- когда последний раз сообщили о непрочитанном (почта, Telegram) — чтобы не повторять
  candidate_notified_at timestamptz,
  employer_notified_at  timestamptz
);
create index if not exists conversations_candidate_idx on public.conversations (candidate_id, last_message_at desc);
create index if not exists conversations_employer_idx on public.conversations (employer_id, last_message_at desc);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid references public.profiles (id) on delete set null,
  -- text — обычное сообщение; application — отклик; status — приглашение или отказ
  kind            text not null default 'text' check (kind in ('text', 'application', 'status')),
  body            text not null check (char_length(body) between 1 and 4000),
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, id);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
revoke all on table public.conversations, public.messages from anon, authenticated;
grant select on table public.conversations, public.messages to authenticated;

drop policy if exists conversations_participant_select on public.conversations;
create policy conversations_participant_select on public.conversations
  for select to authenticated
  using ((select auth.uid()) in (candidate_id, employer_id));

drop policy if exists messages_participant_select on public.messages;
create policy messages_participant_select on public.messages
  for select to authenticated
  using (exists (select 1 from public.conversations c
                  where c.id = messages.conversation_id
                    and (select auth.uid()) in (c.candidate_id, c.employer_id)));

-- Новое сообщение поднимает диалог в списке
create or replace function public.messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end;
$$;
revoke execute on function public.messages_touch_conversation() from public, anon, authenticated;

create or replace trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.messages_touch_conversation();

-- Текст отклика для первого сообщения
create or replace function public.application_message_body(letter text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(left(btrim(letter), 4000), ''), 'Кандидат откликнулся без сопроводительного письма.')
$$;
revoke execute on function public.application_message_body(text) from public, anon, authenticated;

-- Отклик на вакансию работодателя с FastCV открывает диалог
create or replace function public.applications_open_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  conv uuid;
begin
  select id, employer_id, title into v from public.vacancies where id = new.vacancy_id;
  if v.employer_id is null or new.candidate_id is null or v.employer_id = new.candidate_id then
    return null;
  end if;
  insert into public.conversations (application_id, vacancy_id, candidate_id, employer_id, created_at,
                                    last_message_at, candidate_read_at)
  values (new.id, v.id, new.candidate_id, v.employer_id, now(), now(), now())
  on conflict (application_id) do nothing
  returning id into conv;
  if conv is not null then
    insert into public.messages (conversation_id, sender_id, kind, body, meta)
    values (conv, new.candidate_id, 'application', public.application_message_body(new.cover_letter),
            jsonb_build_object('vacancy_title', v.title, 'blitz', coalesce(new.blitz_answers, '[]'::jsonb)));
  end if;
  return null;
end;
$$;
revoke execute on function public.applications_open_conversation() from public, anon, authenticated;

create or replace trigger applications_open_conversation
  after insert on public.applications
  for each row execute function public.applications_open_conversation();

-- Приглашение или отказ из кабинета — сообщением от работодателя в тот же диалог
create or replace function public.applications_status_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conv record;
begin
  if new.status is not distinct from old.status or new.status not in ('interview_scheduled', 'rejected') then
    return null;
  end if;
  select id, employer_id into conv from public.conversations where application_id = new.id;
  if conv.id is null then
    return null;
  end if;
  insert into public.messages (conversation_id, sender_id, kind, body, meta)
  values (conv.id, conv.employer_id, 'status',
          coalesce(nullif(left(btrim(new.hr_message), 4000), ''),
                   case new.status when 'interview_scheduled' then 'Приглашаем вас на собеседование.'
                                   else 'К сожалению, сейчас мы не готовы сделать предложение.' end),
          jsonb_build_object('status', new.status));
  update public.conversations set employer_read_at = now() where id = conv.id;
  return null;
end;
$$;
revoke execute on function public.applications_status_message() from public, anon, authenticated;

create or replace trigger applications_status_message
  after update of status on public.applications
  for each row execute function public.applications_status_message();

-- Отправка сообщения: только участник, не больше 20 сообщений в минуту
create or replace function public.send_message(conversation uuid, body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c record;
  clean text := btrim(coalesce(body, ''));
  m public.messages;
begin
  select id, candidate_id, employer_id into c from public.conversations where id = conversation;
  if uid is null or c.id is null or uid not in (c.candidate_id, c.employer_id) then
    raise exception 'chat: диалог не найден' using errcode = '42501';
  end if;
  if clean = '' then
    raise exception 'chat: пустое сообщение' using errcode = '22023';
  end if;
  if char_length(clean) > 4000 then
    raise exception 'chat: сообщение длиннее 4000 символов' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('chat:' || uid::text, 0));
  if (select count(*) from public.messages
       where sender_id = uid and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'chat: слишком часто — подождите минуту' using errcode = 'P0001';
  end if;
  insert into public.messages (conversation_id, sender_id, kind, body)
  values (c.id, uid, 'text', clean)
  returning * into m;
  -- Своё сообщение — значит, диалог прочитан
  update public.conversations
     set candidate_read_at = case when uid = c.candidate_id then now() else candidate_read_at end,
         employer_read_at  = case when uid = c.employer_id then now() else employer_read_at end
   where id = c.id;
  return to_jsonb(m);
end;
$$;
revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

create or replace function public.mark_conversation_read(conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations
     set candidate_read_at = case when candidate_id = (select auth.uid()) then now() else candidate_read_at end,
         employer_read_at  = case when employer_id = (select auth.uid()) then now() else employer_read_at end
   where id = conversation and (select auth.uid()) in (candidate_id, employer_id)
$$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Список диалогов: собеседник, вакансия, последнее сообщение, непрочитанные
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
         coalesce(v.title, 'Вакансия удалена'),
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
    join public.applications a on a.id = c.application_id
    left join public.vacancies v on v.id = c.vacancy_id
    left join public.profiles p on p.id = c.candidate_id
    left join public.profiles e on e.id = c.employer_id
    left join lateral (select m.body, m.kind, m.sender_id from public.messages m
                        where m.conversation_id = c.id order by m.id desc limit 1) last on true
   order by c.last_message_at desc
   limit 200
$$;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- Число диалогов с непрочитанными сообщениями — для значка в меню
create or replace function public.unread_conversations()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.conversations c
   where (select auth.uid()) in (c.candidate_id, c.employer_id)
     and exists (select 1 from public.messages m
                  where m.conversation_id = c.id and m.sender_id is distinct from (select auth.uid())
                    and m.created_at > coalesce(case when c.candidate_id = (select auth.uid())
                                                     then c.candidate_read_at else c.employer_read_at end,
                                                '-infinity'))
$$;
revoke all on function public.unread_conversations() from public, anon;
grant execute on function public.unread_conversations() to authenticated;

-- Напоминания о непрочитанном (вызывает сборщик): сообщение лежит дольше 15 минут,
-- о нём ещё не сообщали. Адрес почты и чат Telegram — только сервису.
create or replace function public.pending_chat_notifications()
returns table (conversation_id uuid, side text, email text, telegram_chat_id bigint,
               unread integer, other_name text, vacancy_title text)
language sql
stable
security definer
set search_path = ''
as $$
  with sides as (
    select c.id, 'candidate' as side, c.candidate_id as uid, c.candidate_read_at as read_at,
           c.candidate_notified_at as notified_at,
           coalesce(nullif(v.company_name, ''), nullif(e.name, ''), 'Работодатель') as other_name, v.title
      from public.conversations c
      left join public.vacancies v on v.id = c.vacancy_id
      left join public.profiles e on e.id = c.employer_id
    union all
    select c.id, 'employer', c.employer_id, c.employer_read_at, c.employer_notified_at,
           coalesce(nullif(p.name, ''), 'Кандидат'), v.title
      from public.conversations c
      left join public.vacancies v on v.id = c.vacancy_id
      left join public.profiles p on p.id = c.candidate_id
  )
  select s.id, s.side, u.email::text, pr.telegram_chat_id, n.unread, s.other_name, coalesce(s.title, 'вакансия')
    from sides s
    join auth.users u on u.id = s.uid
    join public.profiles pr on pr.id = s.uid
    cross join lateral (
      select count(*)::integer as unread, max(m.created_at) as last_at
        from public.messages m
       where m.conversation_id = s.id and m.sender_id is distinct from s.uid
         and m.created_at > greatest(coalesce(s.read_at, '-infinity'), coalesce(s.notified_at, '-infinity'))
    ) n
   where n.unread > 0
     and n.last_at < now() - interval '15 minutes'
     and n.last_at > now() - interval '7 days'
   limit 200
$$;
revoke all on function public.pending_chat_notifications() from public, anon, authenticated;
grant execute on function public.pending_chat_notifications() to service_role;

create or replace function public.mark_chat_notified(conversation uuid, side text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations
     set candidate_notified_at = case when side = 'candidate' then now() else candidate_notified_at end,
         employer_notified_at  = case when side = 'employer' then now() else employer_notified_at end
   where id = conversation
$$;
revoke all on function public.mark_chat_notified(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_chat_notified(uuid, text) to service_role;

-- Уже существующие отклики на вакансии работодателей — тоже с диалогом (прочитанным,
-- чтобы после выката никому не пришли уведомления о старых откликах)
with apps as (
  select a.*, v.employer_id, v.title
    from public.applications a
    join public.vacancies v on v.id = a.vacancy_id
   where v.employer_id is not null and a.candidate_id is not null and a.candidate_id <> v.employer_id
     and not exists (select 1 from public.conversations c where c.application_id = a.id)
), convs as (
  insert into public.conversations (application_id, vacancy_id, candidate_id, employer_id, created_at,
                                    last_message_at, candidate_read_at, employer_read_at,
                                    candidate_notified_at, employer_notified_at)
  select id, vacancy_id, candidate_id, employer_id, coalesce(created_at, now()),
         coalesce(hr_replied_at, created_at, now()), now(), now(), now(), now()
    from apps
  returning id, application_id
)
insert into public.messages (conversation_id, sender_id, kind, body, meta, created_at)
select c.id, a.candidate_id, 'application', public.application_message_body(a.cover_letter),
       jsonb_build_object('vacancy_title', a.title, 'blitz', coalesce(a.blitz_answers, '[]'::jsonb)),
       coalesce(a.created_at, now())
  from convs c join apps a on a.id = c.application_id
union all
select c.id, a.employer_id, 'status',
       coalesce(nullif(left(btrim(a.hr_message), 4000), ''),
                case a.status when 'interview_scheduled' then 'Приглашаем вас на собеседование.'
                              else 'К сожалению, сейчас мы не готовы сделать предложение.' end),
       jsonb_build_object('status', a.status), coalesce(a.hr_replied_at, a.created_at, now()) + interval '1 second'
  from convs c join apps a on a.id = c.application_id
 where a.status in ('interview_scheduled', 'rejected');

-- Время последнего сообщения у перенесённых диалогов
update public.conversations c
   set last_message_at = m.last_at
  from (select conversation_id, max(created_at) as last_at from public.messages group by conversation_id) m
 where m.conversation_id = c.id and c.last_message_at is distinct from m.last_at;

-- Аудит безопасности знает про функции чата
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
