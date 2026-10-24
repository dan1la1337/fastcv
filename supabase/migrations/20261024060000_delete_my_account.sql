-- Удаление аккаунта по желанию пользователя (152-ФЗ: отзыв согласия и удаление данных).
-- Удаляет профиль (каскадом — отклики кандидата или вакансии работодателя), затем
-- пользователя auth.users (каскадом — избранное, кэш писем, счётчики ИИ, сессии).
-- Файл резюме удаляет сам сайт через Storage API до вызова: из SQL хранилище не чистится.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  delete from public.profiles where id = me;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
