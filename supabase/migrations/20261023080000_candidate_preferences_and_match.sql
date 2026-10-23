-- Что ищет кандидат и насколько вакансия ему подходит.
-- Предпочтения хранятся в профиле; оценка совпадения считается в базе одной функцией,
-- чтобы лента «Для вас» и значок «Совпадение N%» на карточках не расходились.

alter table public.profiles
  add column if not exists pref_directions text[] not null default '{}',
  add column if not exists pref_level text
    constraint profiles_pref_level_check check (pref_level in ('intern', 'junior', 'middle', 'senior', 'lead')),
  add column if not exists pref_format text
    constraint profiles_pref_format_check check (pref_format in ('office', 'hybrid', 'remote')),
  add column if not exists pref_city text,
  add column if not exists pref_salary integer
    constraint profiles_pref_salary_check check (pref_salary between 0 and 100000000);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pref_directions_check') then
    alter table public.profiles add constraint profiles_pref_directions_check check (
      cardinality(pref_directions) <= 5 and pref_directions <@ array[
        'backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml', 'analytics', 'security',
        'gamedev', 'design', 'product', 'marketing', 'content', 'sales', 'hr', 'support', 'finance',
        'education', 'other']::text[]);
  end if;
end;
$$;

-- Оценка 0–100 и объяснение: совпавшие навыки и навыки из вакансии, которых нет в профиле.
--   направление 35 · навыки 35 · уровень 15 · формат и город 10 · зарплата 5
-- Если кандидат что-то не указал, этот пункт даёт средний балл, а не ноль.
create or replace function public.vacancy_match(v public.vacancies, p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  skills as (
    select coalesce(array_agg(distinct lower(btrim(s))) filter (where btrim(s) <> ''), '{}') as list
    from jsonb_array_elements_text(case when jsonb_typeof(p.skills) = 'array' then p.skills else '[]'::jsonb end) s
  ),
  stack as (
    select s as item, lower(btrim(s)) = any (skills.list) as have
    from skills, jsonb_array_elements_text(case when jsonb_typeof(v.stack) = 'array' then v.stack else '[]'::jsonb end) s
  ),
  -- Навыки, которые встречаются в названии вакансии («Python-разработчик» при навыке python)
  in_title as (
    select count(*) as n from unnest((select list from skills)) k
    where length(k) > 1 and lower(v.title) ~ ('(^|[^[:alnum:]])' || regexp_replace(k, '([.+*?^$()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]])')
  ),
  levels as (select array['intern', 'junior', 'middle', 'senior', 'lead'] as order_)
  select jsonb_build_object(
    'score', least(100, greatest(0,
      -- направление
      case when cardinality(p.pref_directions) = 0 then 18
           when v.direction = any (p.pref_directions) then 35 else 0 end
      -- навыки: доля стека, которая есть у кандидата (по первым 6 позициям хватит для оценки)
      + case when cardinality((select list from skills)) = 0 then 15
             when (select count(*) from stack) = 0 then case when (select n from in_title) > 0 then 28 else 12 end
             else round(35.0 * least((select count(*) from stack where have), 6)
                        / least((select count(*) from stack), 6))::int end
      -- уровень: совпал — 15, соседний — 8
      + case when p.pref_level is null or v.level is null then 8
             when v.level = p.pref_level then 15
             when abs(array_position((select order_ from levels), v.level)
                      - array_position((select order_ from levels), p.pref_level)) = 1 then 8
             else 0 end
      -- формат и город
      + case when p.pref_format is null then 7
             when v.work_format = p.pref_format then 10
             when p.pref_format = 'remote' and coalesce(v.is_remote, false) then 10
             when v.work_format = 'remote' then 6
             when v.work_format is null then 5
             else 0 end
        - case when p.pref_city is not null and v.city is not null
                    and coalesce(v.work_format, '') <> 'remote' and not coalesce(v.is_remote, false)
                    and lower(v.city) <> lower(p.pref_city) then 7 else 0 end
      -- зарплата (рубли; вакансии в другой валюте не сравниваем)
      + case when p.pref_salary is null then 3
             when coalesce(v.salary_max, v.salary_min) is null or coalesce(v.salary_currency, 'RUB') <> 'RUB' then 3
             when coalesce(v.salary_max, v.salary_min) >= p.pref_salary then 5
             else 0 end
    )),
    'matched', coalesce((select jsonb_agg(item) from (select item from stack where have limit 6) m), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(item) from (select item from stack where not have limit 4) m), '[]'::jsonb)
  )
$$;

-- Совпадение для вакансий на экране (для текущего пользователя).
create or replace function public.my_vacancy_matches(ids uuid[])
returns table (id uuid, score integer, matched jsonb, missing jsonb)
language sql
stable
set search_path = ''
as $$
  select v.id, (m ->> 'score')::int, m -> 'matched', m -> 'missing'
  from public.profiles p
  join public.vacancies v on v.id = any (ids[1:100])
  cross join lateral public.vacancy_match(v, p) m
  where p.id = (select auth.uid()) and p.role = 'candidate'
$$;

-- Подборка «Для вас»: активные вакансии по убыванию совпадения, свежие выше при равенстве.
create or replace function public.recommended_vacancies(page_size integer default 30, page integer default 0)
returns table (id uuid, score integer, matched jsonb, missing jsonb)
language sql
stable
set search_path = ''
as $$
  select v.id, (m ->> 'score')::int as score, m -> 'matched', m -> 'missing'
  from public.profiles p
  join public.vacancies v on v.archived_at is null
  cross join lateral public.vacancy_match(v, p) m
  where p.id = (select auth.uid()) and p.role = 'candidate'
  order by score desc, coalesce(v.posted_at, v.created_at) desc, v.id
  limit least(greatest(page_size, 1), 50) offset greatest(page, 0) * least(greatest(page_size, 1), 50)
$$;

revoke execute on function public.my_vacancy_matches(uuid[]) from public, anon;
revoke execute on function public.recommended_vacancies(integer, integer) from public, anon;
grant execute on function public.my_vacancy_matches(uuid[]) to authenticated;
grant execute on function public.recommended_vacancies(integer, integer) to authenticated;
