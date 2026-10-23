-- Отдельный бот подборок для кандидатов, отвечающий сразу (webhook на сайте).
-- Бот технических оповещений владельца (TELEGRAM_BOT_TOKEN) с кандидатами больше не общается.
--
-- link_telegram_chat вызывает обработчик webhook (/api/telegram/webhook) публичным ключом:
-- сервисного ключа на сайте нет. Защита — сам код: 32 случайных hex-символа (128 бит),
-- одноразовый, известен только владельцу профиля. Подобрать его перебором невозможно.
create or replace function public.link_telegram_chat(code text, chat bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if code is null or code !~ '^[0-9a-f]{32}$' or chat is null then
    return false;
  end if;
  perform set_config('fastcv.telegram_link', 'on', true);
  update public.profiles
     set telegram_chat_id = chat, telegram_link_code = null, telegram_notify = true
   where telegram_link_code = code and role = 'candidate';
  return found;
end;
$$;

-- Имя бота для ссылки «Подключить Telegram» сохраняет администратор кнопкой в /admin.
create or replace function public.set_telegram_bot(username text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Только для администратора';
  end if;
  if username is null or username !~ '^[A-Za-z0-9_]{5,64}$' then
    raise exception 'Некорректное имя бота';
  end if;
  insert into public.app_settings (key, value, updated_at)
  values ('telegram_bot_username', username, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
end;
$$;

revoke execute on function public.link_telegram_chat(text, bigint) from public;
revoke execute on function public.set_telegram_bot(text) from public, anon;
grant execute on function public.link_telegram_chat(text, bigint) to anon, authenticated, service_role;
grant execute on function public.set_telegram_bot(text) to authenticated;
