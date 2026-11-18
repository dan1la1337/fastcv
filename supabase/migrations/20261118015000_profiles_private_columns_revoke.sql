-- Служебные поля profiles читает только владелец (#141), шаг 2 из 2. Применять после
-- выката сайта, который читает их через my_private_profile() и has_resume (шаг 1).
--
-- profiles_select открывает строку кандидата работодателю, на чью вакансию тот откликнулся, а профиль работодателя — всем
-- вошедшим. Вместе со строкой читались telegram_link_code (работодатель перехватывал
-- привязку Telegram кандидата через link_telegram_chat), telegram_chat_id, resume_path и
-- company_verify_token.
--
-- RLS ограничивает строки, а не колонки, поэтому закрываем колонки правами: anon и
-- authenticated получают SELECT на все колонки, кроме этих четырёх. Владелец читает их
-- через my_private_profile(). service_role (сборщик, боты, рассылки) и функции
-- security definer читают как раньше; запись (UPDATE своего resume_path) не меняется.
--
-- ВАЖНО: новую колонку profiles теперь нужно открыть явно:
--   grant select (новая_колонка) on public.profiles to anon, authenticated;
-- иначе сайт её не прочитает (проверка — tests/db/test_profiles_private_columns.py).
-- И при create or replace функций подборки из шага 1 нужно сохранить security definer.

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name not in ('telegram_link_code', 'telegram_chat_id', 'resume_path', 'company_verify_token');
  revoke select on table public.profiles from anon, authenticated;
  revoke select (telegram_link_code, telegram_chat_id, resume_path, company_verify_token)
    on table public.profiles from anon, authenticated;
  execute format('grant select (%s) on table public.profiles to anon, authenticated', cols);
end;
$$;
