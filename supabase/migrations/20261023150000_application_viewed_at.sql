-- Когда работодатель впервые открыл отклик (план 2.5.1: кандидат видит точное время).
-- Ставит триггер при первом уходе из статуса 'new'; значение из запроса игнорируется,
-- чтобы его нельзя было подделать или сдвинуть. Старые отклики остаются без времени.
alter table public.applications
  add column if not exists viewed_at timestamptz;

create or replace function public.applications_set_viewed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.viewed_at := null;
  elsif old.viewed_at is not null then
    new.viewed_at := old.viewed_at;
  elsif new.status is distinct from 'new' and old.status = 'new' then
    new.viewed_at := now();
  else
    new.viewed_at := null;
  end if;
  return new;
end;
$$;

create or replace trigger applications_viewed_at
  before insert or update on public.applications
  for each row execute function public.applications_set_viewed_at();
