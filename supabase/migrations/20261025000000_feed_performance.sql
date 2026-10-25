-- Производительность при 55k+ вакансий. С 24.10 сайт и сборщик упирались в statement timeout:
-- лента по умолчанию (order by ranking_weight, created_at) читала всю таблицу (3,6 с),
-- archive_stale_vacancies тоже, а справочники зарплат и городов считались заново
-- на каждый запрос (до 10 с).
--
-- На проде индексы созданы заранее через create index concurrently — здесь if not exists.

-- Лента: сортировка по умолчанию идёт по индексу, первые 30 строк — без чтения таблицы
create index if not exists vacancies_feed_order_idx
  on public.vacancies (ranking_weight desc nulls last, created_at desc)
  where archived_at is null;

-- Архив устаревших: тот же предикат, что в archive_stale_vacancies
create index if not exists vacancies_stale_idx
  on public.vacancies ((coalesce(posted_at, created_at)))
  where archived_at is null and source_type = 'external';

-- Справочники — материализованные представления: база пересчитывает их по расписанию
-- (refresh_feed_stats, см. конец файла), сайт читает готовый результат. Вакансии видны всем
-- (политика vacancies_select = true), так что агрегаты без RLS ничего не раскрывают.
drop view if exists public.salary_benchmarks;
create materialized view public.salary_benchmarks as
with s as (
  select direction, level,
         case when salary_min is not null and salary_max is not null then (salary_min + salary_max) / 2.0
              else coalesce(salary_min, salary_max)::numeric end as mid
    from public.vacancies
   where coalesce(salary_currency, 'RUB') = 'RUB'
     and (salary_min is not null or salary_max is not null)
     and direction is not null
     and created_at > now() - interval '90 days'
)
select direction,
       level,
       grouping(level) = 1 as all_levels,
       count(*)::integer as sample,
       round(percentile_cont(0.25) within group (order by mid))::integer as p25,
       round(percentile_cont(0.75) within group (order by mid))::integer as p75
  from s
 where mid between 15000 and 1500000
 group by grouping sets ((direction, level), (direction))
having count(*) >= 10
   and (grouping(level) = 1 or level is not null)
   and percentile_cont(0.75) within group (order by mid) <= 2 * percentile_cont(0.25) within group (order by mid);
create unique index salary_benchmarks_key on public.salary_benchmarks (direction, level, all_levels) nulls not distinct;

drop view if exists public.vacancy_cities;
create materialized view public.vacancy_cities as
select city, count(*)::integer as vacancies
  from public.vacancies
 where archived_at is null and city is not null and btrim(city) <> ''
 group by city;
create unique index vacancy_cities_key on public.vacancy_cities (city);

drop view if exists public.direction_counts;
create materialized view public.direction_counts as
select direction, count(*)::integer as vacancies
  from public.vacancies
 where archived_at is null and direction is not null
 group by direction;
create unique index direction_counts_key on public.direction_counts (direction);

revoke all on public.salary_benchmarks, public.vacancy_cities, public.direction_counts from anon, authenticated;
grant select on public.salary_benchmarks, public.vacancy_cities, public.direction_counts to anon, authenticated;

-- concurrently: сайт читает старые данные, пока считаются новые, — без блокировки
create or replace function public.refresh_feed_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently public.salary_benchmarks;
  refresh materialized view concurrently public.vacancy_cities;
  refresh materialized view concurrently public.direction_counts;
end;
$$;

revoke all on function public.refresh_feed_stats() from public, anon, authenticated;
grant execute on function public.refresh_feed_stats() to service_role;

-- Пересчёт раз в 15 минут внутри базы (pg_cron): у запросов через API таймаут 8 с,
-- а на текущем тарифе пересчёт справочника зарплат занимает около 10 с.
-- В локальной тестовой базе pg_cron нет — там расписание не создаётся.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('refresh-feed-stats', '*/15 * * * *', 'select public.refresh_feed_stats()');
  end if;
end;
$$;
