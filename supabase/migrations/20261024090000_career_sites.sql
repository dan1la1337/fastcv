-- Вакансии с сайтов компаний (source_post career/<компания>/<id>) уходят в архив, когда
-- пропадают из карты сайта компании, а не через 30 дней после публикации.
create or replace function public.archive_stale_vacancies(days integer default 30)
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with archived as (
    update public.vacancies
       set archived_at = now()
     where archived_at is null
       and source_type = 'external'
       and source_post not like 'career/%'
       and coalesce(posted_at, created_at) < now() - make_interval(days => days)
    returning 1
  )
  select count(*)::integer from archived;
$$;

create index if not exists vacancies_career_idx on public.vacancies (source_post)
  where source_post like 'career/%';
