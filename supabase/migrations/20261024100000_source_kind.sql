-- Источник вакансии для фильтра в ленте: telegram, career (сайты компаний), employer
-- (прямые работодатели на FastCV), superjob, trudvsem. Колонка без значения по умолчанию
-- добавляется мгновенно; заполняет её триггер, старые строки — обновлением частями.
alter table public.vacancies add column if not exists source_kind text;

create or replace function public.vacancy_source_kind(source_type text, source_post text)
returns text language sql immutable set search_path = '' as $$
  select case
    when source_type = 'internal' then 'employer'
    when source_post like 'trudvsem/%' then 'trudvsem'
    when source_post like 'superjob/%' then 'superjob'
    when source_post like 'career/%' then 'career'
    else 'telegram'
  end
$$;

create or replace function public.set_source_kind()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.source_kind := public.vacancy_source_kind(new.source_type, new.source_post);
  return new;
end;
$$;

create or replace trigger vacancies_source_kind
  before insert or update of source_type, source_post on public.vacancies
  for each row execute function public.set_source_kind();

create index if not exists vacancies_source_kind_idx on public.vacancies (source_kind, created_at desc)
  where archived_at is null;

-- Заполнить существующие (на проде — частями по 5000, чтобы не держать блокировки)
update public.vacancies set source_kind = public.vacancy_source_kind(source_type, source_post)
 where source_kind is null;
