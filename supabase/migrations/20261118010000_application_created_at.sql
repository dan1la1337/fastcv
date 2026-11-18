-- Время создания отклика ставит база (#144). Дневной лимит (applications_daily_limit)
-- считает отклики по created_at, а клиент мог прислать дату в прошлом и вывести
-- отклик из-под лимита. Для запросов пользователей (auth.uid() задан) created_at
-- всегда now(); сервисные вставки (service_role, демо-данные) не трогаем.
-- Менять created_at потом не даёт prevent_application_tamper.
create or replace function public.applications_set_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.created_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.applications_set_created_at() from public, anon, authenticated;

create or replace trigger applications_set_created_at
  before insert on public.applications
  for each row execute function public.applications_set_created_at();
