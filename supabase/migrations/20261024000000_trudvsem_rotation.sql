-- «Работа России» (opendata.trudvsem.ru): государственная база вакансий с открытым API.
-- На бесплатном тарифе Supabase (500 МБ) храним только свежую часть — вакансии, обновлённые
-- за последние двое суток (~50 тыс.), и чистим остальное после каждого импорта. Вакансии,
-- на которые уже откликнулись или которые кто-то сохранил, не удаляются, а уходят в архив:
-- удаление каскадом стёрло бы отклики кандидатов.
create index if not exists vacancies_trudvsem_idx on public.vacancies (posted_at)
  where source_post like 'trudvsem/%';

create or replace function public.prune_trudvsem(keep_days integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
  archived integer;
begin
  with old as (
    select v.id from public.vacancies v
     where v.source_post like 'trudvsem/%'
       and coalesce(v.posted_at, v.created_at) < now() - make_interval(days => greatest(keep_days, 1))
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

revoke execute on function public.prune_trudvsem(integer) from public, anon, authenticated;
grant execute on function public.prune_trudvsem(integer) to service_role;
