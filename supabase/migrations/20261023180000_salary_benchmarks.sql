-- Оценка скрытой зарплаты (план 2.5.1). Не спрашиваем у ИИ — считаем по нашим же
-- вакансиям с указанной зарплатой в рублях за 90 дней: середина вилки, 25-й и 75-й
-- процентили. Строка попадает в справочник, только если вакансий не меньше 10 и
-- разброс не больше двукратного — иначе «оценка» вводила бы в заблуждение.
-- all_levels = true — по всем уровням направления (для вакансий без уровня).
create or replace view public.salary_benchmarks
with (security_invoker = true) as
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
   and (grouping(level) = 1 or level is not null)   -- «уровень не указан» покрывает строка по всем уровням
   and percentile_cont(0.75) within group (order by mid) <= 2 * percentile_cont(0.25) within group (order by mid);

grant select on public.salary_benchmarks to anon, authenticated;
