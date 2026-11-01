-- Скорость: подборка «Для вас» и страницы компаний падали по таймауту базы.
--
-- 1. recommended_vacancies: условие на направления читалось из строки профиля внутри
--    соединения, и база не могла взять индекс — проходила всю таблицу вакансий (143 МБ,
--    5–17 секунд), а потом считала полное совпадение для 2000 вакансий. Теперь профиль
--    читается заранее (plpgsql), вакансии берутся по индексу (направление, дата), идёт
--    дешёвый предварительный отбор по навыкам с синонимами и смежными и по уровню —
--    300 лучших, и только для них полный расчёт. Порядок выдачи — по полному совпадению.
-- 2. Страница компании ищет вакансии по названию без учёта регистра (ILIKE) — это был
--    полный проход по таблице, ~9 секунд. Триграммный индекс делает поиск мгновенным.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index if not exists vacancies_company_trgm_idx
  on public.vacancies using gin (company_name extensions.gin_trgm_ops);

create or replace function public.recommended_vacancies(page_size integer default 30, page integer default 0)
returns table (id uuid, score integer, matched jsonb, missing jsonb)
language plpgsql
stable
set search_path = ''
as $$
declare
  me public.profiles;
  dirs text[];
  words text[];
  size integer := least(greatest(page_size, 1), 50);
begin
  select * into me from public.profiles p where p.id = (select auth.uid()) and p.role = 'candidate';
  if me.id is null then
    return;
  end if;
  dirs := coalesce(me.pref_directions, '{}');

  -- Все написания навыков, которые засчитаются: свои, их синонимы, смежные навыки и их синонимы
  with keys as (
    select coalesce(array_agg(distinct public.skill_key(s)), '{}') as list
      from jsonb_array_elements_text(case when jsonb_typeof(me.skills) = 'array' then me.skills else '[]'::jsonb end) s
     where btrim(s) <> ''
  ),
  reach as (
    select coalesce(array_agg(distinct k), '{}') as list from (
      select unnest(keys.list) from keys
      union select l.to_skill from public.skill_links l, keys where l.from_skill = any (keys.list)
    ) base_keys(k)
  )
  select coalesce(array_agg(distinct w), '{}') into words from (
    select unnest(reach.list) from reach
    union select a.alias from public.skill_aliases a, reach where a.canonical = any (reach.list)
  ) all_words(w);

  return query
  with candidates as (
    -- по индексу (direction, created_at): свежие вакансии выбранных направлений
    (select v from public.vacancies v
      where cardinality(dirs) > 0 and v.direction = any (dirs) and v.archived_at is null
        and v.created_at > now() - interval '60 days'
      order by v.created_at desc limit 4000)
    union all
    -- направления не выбраны — просто свежие вакансии
    (select v from public.vacancies v
      where cardinality(dirs) = 0 and v.archived_at is null
      order by v.created_at desc limit 4000)
  ),
  pool as (
    select c.v from candidates c
     where not exists (select 1 from public.vacancy_marks h
                        where h.user_id = me.id and h.vacancy_id = (c.v).id and h.kind = 'hidden')
     order by
       (select count(*) from jsonb_array_elements_text(case when jsonb_typeof((c.v).stack) = 'array' then (c.v).stack else '[]'::jsonb end) s
         where lower(btrim(s)) = any (words)) desc,
       (me.pref_level is null or (c.v).level is null or (c.v).level = me.pref_level) desc,
       (c.v).created_at desc
     limit 300
  )
  select (pool.v).id, (m ->> 'score')::int, m -> 'matched', m -> 'missing'
    from pool
    cross join lateral public.vacancy_match(pool.v, me) m
   order by (m ->> 'score')::int desc, coalesce((pool.v).posted_at, (pool.v).created_at) desc, (pool.v).id
   limit size offset greatest(page, 0) * size;
end;
$$;
revoke execute on function public.recommended_vacancies(integer, integer) from public, anon;
grant execute on function public.recommended_vacancies(integer, integer) to authenticated;
