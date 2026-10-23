-- Смысловое совпадение навыков (план 2.5.2). Раньше навыки сравнивались как строки:
-- «Postgres» ≠ «PostgreSQL», «JS» ≠ «JavaScript», а опыт с MySQL не давал ничего
-- для вакансии с PostgreSQL. Теперь:
--   skill_aliases — разные написания одного навыка → одно каноническое имя;
--   skill_links   — что из навыков кандидата засчитывается навыку вакансии:
--                   1.0 — следствие (PostgreSQL → SQL, Django → Python),
--                   0.5 — смежный опыт (MySQL ↔ PostgreSQL, Cypress ↔ Playwright).
-- Словарь можно пополнять обычными insert; ИИ в оценке не участвует.

create table if not exists public.skill_aliases (
  alias     text primary key,
  canonical text not null
);

create table if not exists public.skill_links (
  from_skill text not null,
  to_skill   text not null,
  weight     numeric not null check (weight > 0 and weight <= 1),
  primary key (from_skill, to_skill)
);

alter table public.skill_aliases enable row level security;
alter table public.skill_links enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'skill_aliases' and policyname = 'skill_aliases_read') then
    create policy skill_aliases_read on public.skill_aliases for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'skill_links' and policyname = 'skill_links_read') then
    create policy skill_links_read on public.skill_links for select to anon, authenticated using (true);
  end if;
end;
$$;

grant select on public.skill_aliases, public.skill_links to anon, authenticated, service_role;

insert into public.skill_aliases (alias, canonical) values
  ('postgres', 'postgresql'), ('postgre', 'postgresql'), ('pg', 'postgresql'), ('psql', 'postgresql'),
  ('js', 'javascript'), ('ecmascript', 'javascript'), ('es6', 'javascript'), ('vanilla js', 'javascript'),
  ('ts', 'typescript'),
  ('golang', 'go'),
  ('k8s', 'kubernetes'),
  ('reactjs', 'react'), ('react.js', 'react'), ('react js', 'react'),
  ('vuejs', 'vue'), ('vue.js', 'vue'), ('vue 3', 'vue'), ('vue3', 'vue'), ('vue 2', 'vue'), ('vue2', 'vue'),
  ('nodejs', 'node.js'), ('node', 'node.js'), ('node js', 'node.js'),
  ('nextjs', 'next.js'), ('next js', 'next.js'),
  ('nuxtjs', 'nuxt'), ('nuxt.js', 'nuxt'), ('nuxt 3', 'nuxt'), ('nuxt3', 'nuxt'),
  ('csharp', 'c#'), ('c sharp', 'c#'),
  ('dotnet', '.net'), ('.net core', '.net'), ('net core', '.net'),
  ('python3', 'python'), ('py', 'python'),
  ('torch', 'pytorch'), ('tf', 'tensorflow'), ('sklearn', 'scikit-learn'),
  ('gcp', 'google cloud'), ('google cloud platform', 'google cloud'), ('amazon web services', 'aws'),
  ('ms sql', 'mssql'), ('sql server', 'mssql'), ('ms sql server', 'mssql'), ('t-sql', 'mssql'),
  ('1c', '1с'), ('1с:предприятие', '1с'),
  ('gitlab-ci', 'gitlab ci'), ('gitlab ci/cd', 'gitlab ci'), ('github-actions', 'github actions'),
  ('rest api', 'rest'), ('restful', 'rest'), ('restful api', 'rest'),
  ('objective c', 'objective-c'), ('objc', 'objective-c'),
  ('cpp', 'c++'),
  ('html5', 'html'), ('css3', 'css'), ('scss', 'sass'),
  ('tailwindcss', 'tailwind'), ('tailwind css', 'tailwind'),
  ('spring boot', 'spring'), ('spring framework', 'spring'),
  ('rabbit mq', 'rabbitmq'), ('apache kafka', 'kafka'),
  ('elastic', 'elasticsearch'), ('elastic search', 'elasticsearch'),
  ('mongo', 'mongodb'),
  ('redux toolkit', 'redux'), ('rtk', 'redux'),
  ('unity3d', 'unity'), ('unreal engine', 'unreal'), ('ue5', 'unreal'),
  ('powerbi', 'power bi'), ('ms excel', 'excel'),
  ('ruby on rails', 'rails'), ('ror', 'rails'),
  ('jetpack compose', 'compose'),
  ('apache airflow', 'airflow'), ('apache spark', 'spark'), ('pyspark', 'spark')
on conflict (alias) do nothing;

-- Следствия: кандидат с навыком слева закрывает навык вакансии справа полностью
insert into public.skill_links (from_skill, to_skill, weight) values
  ('postgresql', 'sql', 1), ('mysql', 'sql', 1), ('mssql', 'sql', 1), ('clickhouse', 'sql', 1),
  ('oracle', 'sql', 1), ('sqlite', 'sql', 1), ('mariadb', 'sql', 1),
  ('mariadb', 'mysql', 1), ('mysql', 'mariadb', 1),
  ('typescript', 'javascript', 1),
  ('next.js', 'react', 1), ('nuxt', 'vue', 1),
  ('django', 'python', 1), ('fastapi', 'python', 1), ('flask', 'python', 1),
  ('spring', 'java', 1), ('laravel', 'php', 1), ('symfony', 'php', 1), ('rails', 'ruby', 1),
  ('swiftui', 'swift', 1), ('compose', 'kotlin', 1),
  ('sass', 'css', 1), ('tailwind', 'css', 1),
  ('opensearch', 'elasticsearch', 1), ('elasticsearch', 'opensearch', 1),
  ('spark', 'python', 0.5)
on conflict (from_skill, to_skill) do nothing;

-- Смежный опыт: засчитывается наполовину в обе стороны
insert into public.skill_links (from_skill, to_skill, weight)
select x, y, 0.5 from (values
  ('mysql', 'postgresql'), ('postgresql', 'mssql'), ('mysql', 'mssql'),
  ('java', 'kotlin'), ('swift', 'objective-c'),
  ('aws', 'google cloud'), ('aws', 'azure'), ('google cloud', 'azure'),
  ('docker', 'podman'), ('kubernetes', 'openshift'),
  ('gitlab ci', 'github actions'), ('jenkins', 'gitlab ci'), ('jenkins', 'github actions'),
  ('pytorch', 'tensorflow'), ('kafka', 'rabbitmq'), ('redis', 'memcached'),
  ('jest', 'vitest'), ('playwright', 'cypress'), ('playwright', 'selenium'), ('cypress', 'selenium'),
  ('figma', 'sketch'), ('terraform', 'pulumi'), ('unity', 'unreal'),
  ('tableau', 'power bi'), ('airflow', 'dagster'), ('jira', 'youtrack')
) pairs(a, b)
cross join lateral (values (a, b), (b, a)) dir(x, y)
on conflict do nothing;

-- Каноническое имя навыка: «Postgres» → «postgresql», «JS» → «javascript»
create or replace function public.skill_key(skill text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select a.canonical from public.skill_aliases a where a.alias = lower(btrim(skill))), lower(btrim(skill)))
$$;

grant execute on function public.skill_key(text) to anon, authenticated, service_role;

-- Та же оценка, что раньше (направление 35 · навыки 35 · уровень 15 · формат и город 10 ·
-- зарплата 5), но навыки сравниваются по каноническим именам и связям skill_links.
-- 'missing' — недостающие навыки строками, плюс смежные объектами {"skill", "via"}:
-- навык вакансии и навык кандидата, за который он засчитан наполовину. Старые клиенты
-- объекты пропускают, поэтому формат ответа функций-обёрток не меняется.
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
  stack as (
    select s as item, public.skill_key(s) as key, ord
    from jsonb_array_elements_text(case when jsonb_typeof(v.stack) = 'array' then v.stack else '[]'::jsonb end)
         with ordinality as t(s, ord)
  ),
  scored as (
    select st.item, st.ord,
           case when st.key = any (sk.list) then 1.0 else coalesce(best.weight, 0) end as credit,
           best.from_skill as via_key
    from stack st
    cross join skills sk
    left join lateral (
      select l.weight, l.from_skill from public.skill_links l
      where l.to_skill = st.key and l.from_skill = any (sk.list)
      order by l.weight desc, l.from_skill limit 1
    ) best on true
  ),
  in_title as (
    select count(*) as n from unnest((select names from skills)) k
    where length(k) > 1 and lower(v.title) ~ ('(^|[^[:alnum:]])' || regexp_replace(k, '([.+*?^$()\[\]{}|\\])', '\\\1', 'g') || '($|[^[:alnum:]])')
  ),
  levels as (select array['intern', 'junior', 'middle', 'senior', 'lead'] as order_)
  select jsonb_build_object(
    'score', least(100, greatest(0,
      case when cardinality(p.pref_directions) = 0 then 18
           when v.direction = any (p.pref_directions) then 35 else 0 end
      + case when cardinality((select list from skills)) = 0 then 15
             when (select count(*) from stack) = 0 then case when (select n from in_title) > 0 then 28 else 12 end
             else round(35.0 * least((select sum(credit) from scored), 6)
                        / least((select count(*) from stack), 6))::int end
      + case when p.pref_level is null or v.level is null then 8
             when v.level = p.pref_level then 15
             when abs(array_position((select order_ from levels), v.level)
                      - array_position((select order_ from levels), p.pref_level)) = 1 then 8
             else 0 end
      + case when p.pref_format is null then 7
             when v.work_format = p.pref_format then 10
             when p.pref_format = 'remote' and coalesce(v.is_remote, false) then 10
             when v.work_format = 'remote' then 6
             when v.work_format is null then 5
             else 0 end
        - case when p.pref_city is not null and v.city is not null
                    and coalesce(v.work_format, '') <> 'remote' and not coalesce(v.is_remote, false)
                    and lower(v.city) <> lower(p.pref_city) then 7 else 0 end
      + case when p.pref_salary is null then 3
             when coalesce(v.salary_max, v.salary_min) is null or coalesce(v.salary_currency, 'RUB') <> 'RUB' then 3
             when coalesce(v.salary_max, v.salary_min) >= p.pref_salary then 5
             else 0 end
    )),
    'matched', coalesce((select jsonb_agg(item order by ord) from (select item, ord from scored where credit >= 1 order by ord limit 6) m), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(item order by ord) from (select item, ord from scored where credit = 0 order by ord limit 4) m), '[]'::jsonb)
             || coalesce((select jsonb_agg(jsonb_build_object(
                           'skill', item,
                           'via', (select r.orig from raw r where r.key = via_key order by r.orig limit 1)) order by ord)
                          from (select item, via_key, ord from scored where credit > 0 and credit < 1 order by ord limit 3) m), '[]'::jsonb)
  )
$$;
