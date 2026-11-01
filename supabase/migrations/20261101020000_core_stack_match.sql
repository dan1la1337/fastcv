-- Совпадение по основному стеку. Раньше навыки давали полный балл, как только совпадали
-- любые 6 из списка вакансии: .NET-вакансия получала 97% у Java-разработчика за Kafka,
-- PostgreSQL, Docker и Kubernetes. Теперь навыки делятся на основной стек (язык и
-- платформа: Java, C#/.NET, Python…) и остальное (базы, очереди, инфраструктура).
--
-- Оценка (100): направление 20 · основной стек 35 · остальные навыки 15 · уровень 15 ·
-- формат и город 10 · зарплата 5. Если основной стек вакансии вообще не ваш (ни своего,
-- ни смежного языка) — итог не выше 40: такая вакансия всегда ниже вакансий своего стека.

-- Экосистема навыка: язык, к которому относится платформа или фреймворк
create table if not exists public.skill_stack (
  skill     text primary key,
  ecosystem text not null
);
alter table public.skill_stack enable row level security;
revoke all on table public.skill_stack from anon, authenticated;
grant select on table public.skill_stack to anon, authenticated;
drop policy if exists skill_stack_read on public.skill_stack;
create policy skill_stack_read on public.skill_stack for select to anon, authenticated using (true);

-- Близкие экосистемы: опыт засчитывается частично (в обе стороны)
create table if not exists public.ecosystem_links (
  from_eco text not null,
  to_eco   text not null,
  weight   numeric not null check (weight > 0 and weight < 1),
  primary key (from_eco, to_eco)
);
alter table public.ecosystem_links enable row level security;
revoke all on table public.ecosystem_links from anon, authenticated;
grant select on table public.ecosystem_links to anon, authenticated;
drop policy if exists ecosystem_links_read on public.ecosystem_links;
create policy ecosystem_links_read on public.ecosystem_links for select to anon, authenticated using (true);

-- Новые написания, чтобы платформы сводились к одному имени
insert into public.skill_aliases (alias, canonical) values
  ('asp.net core', 'asp.net'), ('asp.net mvc', 'asp.net'), ('asp .net', 'asp.net'), ('aspnet', 'asp.net'),
  ('entity framework core', 'entity framework'), ('ef core', 'entity framework'), ('ef', 'entity framework'),
  ('net', '.net'), ('.net framework', '.net'), ('.net 6', '.net'), ('.net 7', '.net'), ('.net 8', '.net'),
  ('java 8', 'java'), ('java 11', 'java'), ('java 17', 'java'), ('java 21', 'java'), ('java 21+', 'java'), ('java ee', 'java'), ('jakarta ee', 'java'),
  ('spring cloud', 'spring'), ('spring data', 'spring'), ('spring mvc', 'spring'), ('spring security', 'spring'),
  ('nest.js', 'nestjs'), ('nest', 'nestjs'), ('express.js', 'express'), ('expressjs', 'express'),
  ('angularjs', 'angular'), ('angular 2+', 'angular'), ('react-native', 'react native'),
  ('golang developer', 'go'), ('python 3', 'python'), ('c/c++', 'c++'),
  ('1с-битрикс', 'bitrix'), ('битрикс', 'bitrix'), ('1c-bitrix', 'bitrix'), ('bitrix24', 'bitrix')
on conflict (alias) do nothing;

insert into public.skill_stack (skill, ecosystem) values
  ('java', 'java'), ('spring', 'java'), ('hibernate', 'java'), ('jpa', 'java'), ('quarkus', 'java'), ('micronaut', 'java'),
  ('kotlin', 'kotlin'), ('ktor', 'kotlin'), ('compose', 'kotlin'),
  ('scala', 'scala'), ('akka', 'scala'),
  ('c#', 'csharp'), ('.net', 'csharp'), ('asp.net', 'csharp'), ('entity framework', 'csharp'), ('blazor', 'csharp'),
  ('wpf', 'csharp'), ('xamarin', 'csharp'), ('unity', 'csharp'),
  ('python', 'python'), ('django', 'python'), ('fastapi', 'python'), ('flask', 'python'), ('aiohttp', 'python'),
  ('go', 'go'),
  ('javascript', 'javascript'), ('typescript', 'javascript'), ('node.js', 'javascript'), ('react', 'javascript'),
  ('vue', 'javascript'), ('angular', 'javascript'), ('next.js', 'javascript'), ('nuxt', 'javascript'),
  ('nestjs', 'javascript'), ('express', 'javascript'), ('svelte', 'javascript'), ('react native', 'javascript'),
  ('php', 'php'), ('laravel', 'php'), ('symfony', 'php'), ('yii', 'php'), ('bitrix', 'php'),
  ('ruby', 'ruby'), ('rails', 'ruby'),
  ('c++', 'cpp'), ('qt', 'cpp'), ('unreal', 'cpp'),
  ('c', 'c'),
  ('rust', 'rust'),
  ('swift', 'swift'), ('swiftui', 'swift'), ('uikit', 'swift'),
  ('objective-c', 'objc'),
  ('dart', 'dart'), ('flutter', 'dart'),
  ('1с', '1c'),
  ('elixir', 'elixir'), ('erlang', 'erlang'), ('haskell', 'haskell'), ('perl', 'perl'), ('lua', 'lua'),
  ('solidity', 'solidity'), ('abap', 'abap'), ('delphi', 'delphi'), ('clojure', 'clojure')
on conflict (skill) do update set ecosystem = excluded.ecosystem;

insert into public.ecosystem_links (from_eco, to_eco, weight)
select a, b, w from (values
  ('java', 'kotlin', 0.6), ('java', 'scala', 0.4), ('kotlin', 'scala', 0.3),
  ('swift', 'objc', 0.6), ('c', 'cpp', 0.6), ('elixir', 'erlang', 0.6)
) x(a, b, w)
union all
select b, a, w from (values
  ('java', 'kotlin', 0.6), ('java', 'scala', 0.4), ('kotlin', 'scala', 0.3),
  ('swift', 'objc', 0.6), ('c', 'cpp', 0.6), ('elixir', 'erlang', 0.6)
) x(a, b, w)
on conflict (from_eco, to_eco) do update set weight = excluded.weight;

-- Основной стек кандидата: на чём он работает (до 5 навыков). Пусто — выводим из всех навыков
alter table public.profiles add column if not exists primary_skills jsonb not null default '[]'::jsonb
  check (jsonb_typeof(primary_skills) = 'array' and jsonb_array_length(primary_skills) <= 5);

create or replace function public.vacancy_match(v public.vacancies, p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  raw as (
    select btrim(s) as orig, public.skill_key(s) as key
    from jsonb_array_elements_text(case when jsonb_typeof(p.skills) = 'array' then p.skills else '[]'::jsonb end) s
    where btrim(s) <> ''
  ),
  skills as (
    select coalesce(array_agg(distinct key), '{}') as list,
           coalesce(array_agg(distinct lower(orig)), '{}') as names
    from raw
  ),
  primary_keys as (
    select coalesce(array_agg(distinct public.skill_key(s)), '{}') as list
    from jsonb_array_elements_text(case when jsonb_typeof(p.primary_skills) = 'array' then p.primary_skills else '[]'::jsonb end) s
    where btrim(s) <> ''
  ),
  -- Основной стек кандидата: из «основного стека», а если он пуст — из всех навыков
  my_eco as (
    select coalesce(array_agg(distinct st.ecosystem), '{}') as list
    from public.skill_stack st
    where st.skill = any (case when cardinality((select list from primary_keys)) > 0
                               then (select list from primary_keys) else (select list from skills) end)
  ),
  stack as (
    select s as item, public.skill_key(s) as key, ord
    from jsonb_array_elements_text(case when jsonb_typeof(v.stack) = 'array' then v.stack else '[]'::jsonb end)
         with ordinality as t(s, ord)
  ),
  typed as (
    select st.*, sk.ecosystem from stack st left join public.skill_stack sk on sk.skill = st.key
  ),
  scored as (
    select t.item, t.ord, t.ecosystem,
           case when t.key = any (sk.list) then 1.0 else coalesce(best.weight, 0) end as credit,
           best.from_skill as via_key
    from typed t
    cross join skills sk
    left join lateral (
      select l.weight, l.from_skill from public.skill_links l
      where l.to_skill = t.key and l.from_skill = any (sk.list)
      order by l.weight desc, l.from_skill limit 1
    ) best on true
  ),
  -- Экосистемы вакансии и насколько каждая ваша: 1 — ваша, доля — смежная, 0 — чужая
  vac_eco as (
    select e.ecosystem,
           case when e.ecosystem = any (me.list) then 1.0
                else coalesce((select max(l.weight) from public.ecosystem_links l
                                where l.to_eco = e.ecosystem and l.from_eco = any (me.list)), 0) end as fit
    from (select distinct ecosystem from typed where ecosystem is not null) e
    cross join my_eco me
  ),
  core as (
    select count(*) as n, coalesce(max(fit), 0) as best,
           coalesce(avg(least(fit, 1)), 0) as coverage
    from vac_eco
  ),
  secondary as (
    select count(*) as n, coalesce(sum(credit), 0) as got
    from (select credit from scored where ecosystem is null order by ord limit 10) s
  ),
  in_title as (
    select count(*) as n from unnest((select names from skills)) k
    where length(k) > 1 and lower(v.title) ~ ('(^|[^[:alnum:]])' || regexp_replace(k, '([.+*?^$()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]])')
  ),
  levels as (select array['intern', 'junior', 'middle', 'senior', 'lead'] as order_),
  parts as (
    select
      case when cardinality(p.pref_directions) = 0 then 12
           when v.direction = any (p.pref_directions) then 20 else 0 end as dir,
      -- основной стек
      case when cardinality((select list from skills)) = 0 then 15
           when (select n from core) > 0 and cardinality((select list from my_eco)) > 0
             then round(35 * (0.75 * (select best from core) + 0.25 * (select coverage from core)))
           when (select n from core) > 0 then 12   -- в вакансии есть язык, а у кандидата языков в навыках нет
           when (select count(*) from stack) = 0 then case when (select n from in_title) > 0 then 28 else 12 end
           -- языка в вакансии нет: о стеке судим только по остальным навыкам, и с меньшим весом
           when (select n from secondary) > 0 then round(25.0 * (select got from secondary) / (select n from secondary))
           else 12 end as core_pts,
      -- остальные навыки: базы, очереди, инфраструктура
      case when cardinality((select list from skills)) = 0 then 7
           when (select count(*) from stack) = 0 then 4   -- стека в вакансии нет: судить не по чему
           when (select n from secondary) = 0 then 10
           else round(15.0 * (select got from secondary) / (select n from secondary)) end as sec_pts,
      case when p.experience_years is not null and v.experience_min is not null then
             case when p.experience_years >= v.experience_min then 15
                  when p.experience_years >= v.experience_min - 1 then 8
                  else 0 end
           when p.pref_level is null or v.level is null then 8
           when v.level = p.pref_level then 15
           when abs(array_position((select order_ from levels), v.level)
                    - array_position((select order_ from levels), p.pref_level)) = 1 then 8
           else 0 end as lvl,
      case when cardinality(p.pref_formats) > 0 then
             case when v.work_format = any (p.pref_formats) then 10
                  when 'remote' = any (p.pref_formats) and coalesce(v.is_remote, false) then 10
                  when v.work_format is null then 5
                  else 0 end
           when p.pref_format is null then 7
           when v.work_format = p.pref_format then 10
           when p.pref_format = 'remote' and coalesce(v.is_remote, false) then 10
           when v.work_format = 'remote' then 6
           when v.work_format is null then 5
           else 0 end
      - case when p.pref_city is not null and v.city is not null
                  and coalesce(v.work_format, '') <> 'remote' and not coalesce(v.is_remote, false)
                  and lower(v.city) <> lower(p.pref_city) then 7 else 0 end as fmt,
      case when p.pref_salary is null then 3
           when coalesce(v.salary_max, v.salary_min) is null or coalesce(v.salary_currency, 'RUB') <> 'RUB' then 3
           when coalesce(v.salary_max, v.salary_min) >= p.pref_salary then 5
           else 0 end as sal,
      -- основной стек вакансии чужой: ни своего, ни смежного языка
      ((select n from core) > 0 and cardinality((select list from my_eco)) > 0 and (select best from core) = 0) as foreign_stack
  )
  select jsonb_build_object(
    'score', case when foreign_stack then least(40, total) else total end,
    'matched', coalesce((select jsonb_agg(item order by ord) from (select item, ord from scored where credit >= 1 order by ecosystem is null, ord limit 6) m), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(item order by ecosystem is null, ord) from (select item, ord, ecosystem from scored where credit = 0 order by ecosystem is null, ord limit 4) m), '[]'::jsonb)
             || coalesce((select jsonb_agg(jsonb_build_object(
                           'skill', item,
                           'via', (select r.orig from raw r where r.key = via_key order by r.orig limit 1)) order by ord)
                          from (select item, via_key, ord from scored where credit > 0 and credit < 1 order by ord limit 3) m), '[]'::jsonb),
    -- основной стек вакансии и ваш ли он: match / related / foreign; нет языка в вакансии — null
    'core', case when (select n from core) = 0 then null else jsonb_build_object(
      'fit', case when (select best from core) >= 1 then 'match'
                  when (select best from core) > 0 then 'related'
                  when cardinality((select list from my_eco)) = 0 then 'unknown'
                  else 'foreign' end,
      'stack', coalesce((select jsonb_agg(item order by ord) from (select item, ord from typed where ecosystem is not null order by ord limit 3) c), '[]'::jsonb)) end
  )
  from (select parts.*, least(100, greatest(0, dir + core_pts + sec_pts + lvl + fmt + sal))::int as total from parts) parts
$$;

-- Функции-обёртки отдают ещё и основной стек (core): меняется состав колонок — пересоздаём
drop function if exists public.my_vacancy_matches(uuid[]);
create function public.my_vacancy_matches(ids uuid[])
returns table (id uuid, score integer, matched jsonb, missing jsonb, core jsonb)
language sql
stable
set search_path = ''
as $$
  select v.id, (m ->> 'score')::int, m -> 'matched', m -> 'missing', m -> 'core'
  from public.profiles p
  join public.vacancies v on v.id = any (ids[1:100])
  cross join lateral public.vacancy_match(v, p) m
  where p.id = (select auth.uid()) and p.role = 'candidate'
$$;
revoke execute on function public.my_vacancy_matches(uuid[]) from public, anon;
grant execute on function public.my_vacancy_matches(uuid[]) to authenticated;

drop function if exists public.my_application_matches();
create function public.my_application_matches()
returns table (application_id uuid, score integer, matched jsonb, missing jsonb, core jsonb)
language sql
stable
set search_path = ''
as $$
  select a.id, (m ->> 'score')::int, m -> 'matched', m -> 'missing', m -> 'core'
  from public.applications a
  join public.vacancies v on v.id = a.vacancy_id and v.employer_id = (select auth.uid())
  join public.profiles p on p.id = a.candidate_id
  cross join lateral public.vacancy_match(v, p) m
$$;
revoke execute on function public.my_application_matches() from public, anon;
grant execute on function public.my_application_matches() to authenticated;

-- Подборка: в предотборе сначала вакансии своего стека (или без языка), потом по навыкам
drop function if exists public.recommended_vacancies(integer, integer);
create function public.recommended_vacancies(page_size integer default 30, page integer default 0)
returns table (id uuid, score integer, matched jsonb, missing jsonb, core jsonb)
language plpgsql
stable
set search_path = ''
as $$
declare
  me public.profiles;
  dirs text[];
  words text[];
  core_mine text[];
  core_all text[];
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

  -- Написания навыков своего основного стека (и смежных экосистем) и всех языков вообще
  with prim as (
    select coalesce(array_agg(distinct public.skill_key(s)), '{}') as list
      from jsonb_array_elements_text(case when jsonb_array_length(me.primary_skills) > 0 then me.primary_skills
                                          when jsonb_typeof(me.skills) = 'array' then me.skills else '[]'::jsonb end) s
     where btrim(s) <> ''
  ),
  eco as (
    select coalesce(array_agg(distinct e), '{}') as list from (
      select st.ecosystem from public.skill_stack st, prim where st.skill = any (prim.list)
      union select l.to_eco from public.ecosystem_links l, public.skill_stack st, prim
             where st.skill = any (prim.list) and l.from_eco = st.ecosystem and l.weight >= 0.5
    ) x(e)
  )
  select coalesce(array_agg(distinct w), '{}') into core_mine from (
    select st.skill from public.skill_stack st, eco where st.ecosystem = any (eco.list)
    union select a.alias from public.skill_aliases a join public.skill_stack st on st.skill = a.canonical, eco
           where st.ecosystem = any (eco.list)
  ) x(w);
  select coalesce(array_agg(distinct w), '{}') into core_all from (
    select skill from public.skill_stack
    union select a.alias from public.skill_aliases a join public.skill_stack st on st.skill = a.canonical
  ) x(w);

  return query
  with candidates as (
    (select v from public.vacancies v
      where cardinality(dirs) > 0 and v.direction = any (dirs) and v.archived_at is null
        and v.created_at > now() - interval '60 days'
      order by v.created_at desc limit 4000)
    union all
    (select v from public.vacancies v
      where cardinality(dirs) = 0 and v.archived_at is null
      order by v.created_at desc limit 4000)
  ),
  marked as (
    select c.v, s.words_hit, s.mine, s.langs
      from candidates c
      cross join lateral (
        select count(*) filter (where w = any (words)) as words_hit,
               bool_or(w = any (core_mine)) as mine,
               bool_or(w = any (core_all)) as langs
          from (select lower(btrim(x)) as w
                  from jsonb_array_elements_text(case when jsonb_typeof((c.v).stack) = 'array' then (c.v).stack else '[]'::jsonb end) x) t
      ) s
     where not exists (select 1 from public.vacancy_marks h
                        where h.user_id = me.id and h.vacancy_id = (c.v).id and h.kind = 'hidden')
  ),
  pool as (
    select m.v from marked m
     order by
       (coalesce(m.mine, false) or not coalesce(m.langs, false)) desc,
       m.words_hit desc,
       (me.pref_level is null or (m.v).level is null or (m.v).level = me.pref_level) desc,
       (m.v).created_at desc
     limit 300
  )
  select (pool.v).id, (m ->> 'score')::int, m -> 'matched', m -> 'missing', m -> 'core'
    from pool
    cross join lateral public.vacancy_match(pool.v, me) m
   order by (m ->> 'score')::int desc, coalesce((pool.v).posted_at, (pool.v).created_at) desc, (pool.v).id
   limit size offset greatest(page, 0) * size;
end;
$$;
revoke execute on function public.recommended_vacancies(integer, integer) from public, anon;
grant execute on function public.recommended_vacancies(integer, integer) to authenticated;
