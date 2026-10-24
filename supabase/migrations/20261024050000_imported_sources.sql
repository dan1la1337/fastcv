-- Общая чистка для источников без ИИ («Работа России», SuperJob): удаляет вакансии старше
-- окна хранения, а те, на которые откликнулись или которые кто-то сохранил, архивирует —
-- удаление каскадом стёрло бы отклики. Окно в часах: SuperJob даёт ~60 тыс. вакансий в сутки,
-- и на бесплатном тарифе базы храним только последние часы.
create index if not exists vacancies_superjob_idx on public.vacancies (posted_at)
  where source_post like 'superjob/%';

create or replace function public.prune_imported(source text, keep_hours integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
  archived integer;
begin
  if source not in ('trudvsem', 'superjob') then
    raise exception 'unknown source %', source;
  end if;
  with old as (
    select v.id from public.vacancies v
     where v.source_post like source || '/%'
       and coalesce(v.posted_at, v.created_at) < now() - make_interval(hours => greatest(keep_hours, 1))
  ),
  kept as (
    select o.id from old o
     where exists (select 1 from public.applications a where a.vacancy_id = o.id)
        or exists (select 1 from public.vacancy_marks m where m.vacancy_id = o.id)
  ),
  arch as (
    update public.vacancies set archived_at = now()
     where id in (select id from kept) and archived_at is null
    returning 1
  ),
  del as (
    delete from public.vacancies where id in (select id from old except select id from kept)
    returning 1
  )
  select (select count(*) from del), (select count(*) from arch) into removed, archived;
  return jsonb_build_object('removed', removed, 'archived', archived);
end;
$$;

revoke execute on function public.prune_imported(text, integer) from public, anon, authenticated;
grant execute on function public.prune_imported(text, integer) to service_role;
