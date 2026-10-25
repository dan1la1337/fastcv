-- Живой счётчик на главной (редизайн «Аврора»): сколько вакансий в ленте, сколько новых за
-- сутки, когда пришла последняя, сколько каналов и сайтов компаний собираем. Всего — из
-- справочника direction_counts (пересчёт раз в 15 минут), остальное — по индексам.
-- Сайт кэширует ответ на минуту (/api/live-stats), так что база отвечает редко.
create or replace function public.live_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select coalesce(sum(vacancies), 0) from public.direction_counts),
    'new_24h', (select count(*) from public.vacancies where created_at > now() - interval '24 hours'),
    'last_at', (select max(created_at) from public.vacancies),
    'channels', (select count(*) from public.channels where is_active),
    'companies', (select count(distinct split_part(source_post, '/', 2)) from public.vacancies
                   where source_post like 'career/%' and archived_at is null)
  )
$$;

revoke all on function public.live_stats() from public;
grant execute on function public.live_stats() to anon, authenticated, service_role;
