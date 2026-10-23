-- Подписка кандидата на подборку в Telegram.
-- Привязка: кандидат получает одноразовый код (create_telegram_link_code), открывает
-- бота по ссылке t.me/<бот>?start=<код>; сборщик при запуске читает сообщения бота,
-- находит код и сохраняет chat_id. После каждого сбора — до 5 новых подходящих вакансий.

alter table public.profiles
  add column if not exists telegram_chat_id bigint,
  add column if not exists telegram_link_code text,
  add column if not exists telegram_notify boolean not null default false,
  add column if not exists telegram_notified_at timestamptz;

create unique index if not exists profiles_telegram_link_code_key on public.profiles (telegram_link_code);

-- Пользователь не может сам вписать себе chat_id или код (иначе бот писал бы в чужой чат);
-- это делают только функции ниже и сборщик (service-role).
create or replace function public.prevent_telegram_tamper()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and current_setting('fastcv.telegram_link', true) is distinct from 'on'
     and (new.telegram_chat_id, new.telegram_link_code, new.telegram_notified_at)
         is distinct from (old.telegram_chat_id, old.telegram_link_code, old.telegram_notified_at) then
    raise exception 'Привязку Telegram меняет только сервис';
  end if;
  return new;
end;
$$;

create or replace trigger profiles_prevent_telegram_tamper
  before update on public.profiles
  for each row execute function public.prevent_telegram_tamper();

-- Новый одноразовый код привязки для текущего кандидата.
create or replace function public.create_telegram_link_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text := replace(pg_catalog.gen_random_uuid()::text, '-', '');
begin
  perform set_config('fastcv.telegram_link', 'on', true);
  update public.profiles set telegram_link_code = code
   where id = (select auth.uid()) and role = 'candidate';
  if not found then
    raise exception 'Только для соискателей';
  end if;
  return code;
end;
$$;

-- Отвязать Telegram.
create or replace function public.unlink_telegram()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('fastcv.telegram_link', 'on', true);
  update public.profiles
     set telegram_chat_id = null, telegram_link_code = null, telegram_notify = false
   where id = (select auth.uid());
end;
$$;

revoke execute on function public.create_telegram_link_code() from public, anon;
revoke execute on function public.unlink_telegram() from public, anon;
grant execute on function public.create_telegram_link_code() to authenticated;
grant execute on function public.unlink_telegram() to authenticated;

-- Публичные настройки сайта (например, имя бота для ссылки «Подключить Telegram»).
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings' and policyname = 'app_settings_public_read') then
    create policy app_settings_public_read on public.app_settings
      for select to anon, authenticated using (key in ('telegram_bot_username'));
  end if;
end;
$$;

-- Подборка для рассылки (вызывает только сборщик): по каждому подписчику — до 5 новых
-- вакансий с совпадением от min_score, появившихся после прошлой рассылки (но не старше суток).
create or replace function public.telegram_digest(min_score integer default 70)
returns table (user_id uuid, chat_id bigint, items jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.telegram_chat_id,
         jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'company', x.company_name, 'score', x.score)
                   order by x.score desc)
  from public.profiles p
  cross join lateral (
    select * from (
      select v.id, v.title, v.company_name, (public.vacancy_match(v, p) ->> 'score')::int as score
      from public.vacancies v
      where v.archived_at is null
        and v.created_at > greatest(coalesce(p.telegram_notified_at, now() - interval '1 day'), now() - interval '1 day')
        and not exists (select 1 from public.vacancy_marks h where h.user_id = p.id and h.vacancy_id = v.id and h.kind = 'hidden')
    ) scored
    where scored.score >= min_score
    order by scored.score desc
    limit 5
  ) x
  where p.role = 'candidate' and p.telegram_notify and p.telegram_chat_id is not null
  group by p.id, p.telegram_chat_id
$$;

revoke execute on function public.telegram_digest(integer) from public, anon, authenticated;
grant execute on function public.telegram_digest(integer) to service_role;
