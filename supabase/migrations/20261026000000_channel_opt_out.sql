-- Исключение канала по просьбе владельца (план, 1.1). Канал перестаёт собираться,
-- его вакансии уходят в архив и пропадают из ленты. Отметка excluded_at не даёт
-- случайно вернуть канал: миграции добавляют каналы через on conflict do nothing,
-- а сборщик читает только is_active.
alter table public.channels
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_note text;

create or replace function public.exclude_channel(p_username text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  name text := lower(trim(both '@' from trim(coalesce(p_username, ''))));
  archived integer;
begin
  if not (public.is_app_admin() or coalesce((select auth.jwt()) ->> 'role', '') = 'service_role') then
    raise exception 'Только для администраторов' using errcode = '42501';
  end if;
  if name = '' or name !~ '^[a-z0-9_]{4,64}$' then
    raise exception 'Неверное имя канала' using errcode = '22023';
  end if;

  -- Канала может и не быть в списке: запоминаем отказ заранее, чтобы его не добавили потом
  if not exists (select 1 from public.channels where lower(username) = name) then
    insert into public.channels (username, category, is_active) values (name, 'general', false);
  end if;
  update public.channels
     set is_active = false, excluded_at = coalesce(excluded_at, now()),
         excluded_note = coalesce(left(p_note, 300), excluded_note)
   where lower(username) = name;

  -- source_post начинается с имени канала в его написании («JobOfferInside/123»):
  -- сравниваем с точным написанием, чтобы поиск шёл по индексу префиксов
  update public.vacancies v
     set archived_at = now()
    from public.channels c
   where lower(c.username) = name
     and v.archived_at is null
     and v.source_type = 'external'
     and v.source_post like c.username || '/%';
  get diagnostics archived = row_count;
  return archived;
end;
$$;

revoke all on function public.exclude_channel(text, text) from public, anon;
grant execute on function public.exclude_channel(text, text) to authenticated, service_role;

-- Список исключённых — для страницы метрик администратора
create or replace function public.excluded_channels()
returns table (username text, excluded_at timestamptz, excluded_note text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Только для администраторов' using errcode = '42501';
  end if;
  return query
    select c.username, c.excluded_at, c.excluded_note
      from public.channels c
     where c.excluded_at is not null
     order by c.excluded_at desc;
end;
$$;

revoke all on function public.excluded_channels() from public, anon;
grant execute on function public.excluded_channels() to authenticated;
