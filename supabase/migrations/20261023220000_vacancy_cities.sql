-- Города для выпадающего списка в фильтрах: только те, где есть открытые вакансии,
-- с их числом. Права — как у вакансий (security_invoker).
create or replace view public.vacancy_cities
with (security_invoker = true) as
select city, count(*)::integer as vacancies
  from public.vacancies
 where archived_at is null and city is not null and btrim(city) <> ''
 group by city;

grant select on public.vacancy_cities to anon, authenticated;
