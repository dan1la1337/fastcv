-- Опыт работы вместо выбора уровня и несколько форматов работы.
--   vacancies.experience_min — требуемый опыт в годах (ИИ сборщика по тексту вакансии);
--   profiles.experience_years — опыт кандидата; грейд в профиле считается по шкале FastCV
--   (до 2 лет — junior, 2–5 — middle, от 5 — senior), руководство людьми — lead;
--   profiles.pref_formats — подходящие форматы (можно несколько).
-- vacancy_match сравнивает опыт напрямую, когда он известен с обеих сторон.

alter table public.vacancies
  add column if not exists experience_min numeric(3,1);

alter table public.profiles
  add column if not exists experience_years numeric(3,1),
  add column if not exists pref_formats text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vacancies_experience_min_check') then
    alter table public.vacancies add constraint vacancies_experience_min_check check (experience_min between 0 and 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_experience_years_check') then
    alter table public.profiles add constraint profiles_experience_years_check check (experience_years between 0 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_pref_formats_check') then
    alter table public.profiles add constraint profiles_pref_formats_check
      check (pref_formats <@ array['office', 'hybrid', 'remote']::text[]);
  end if;
end;
$$;

-- Перенести одиночный формат в список
update public.profiles set pref_formats = array[pref_format]
 where pref_format is not null and cardinality(pref_formats) = 0;

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
      -- уровень: если известны и опыт кандидата, и требуемый опыт — сравниваем годы напрямую
      + case when p.experience_years is not null and v.experience_min is not null then
               case when p.experience_years >= v.experience_min then 15
                    when p.experience_years >= v.experience_min - 1 then 8
                    else 0 end
             when p.pref_level is null or v.level is null then 8
             when v.level = p.pref_level then 15
             when abs(array_position((select order_ from levels), v.level)
                      - array_position((select order_ from levels), p.pref_level)) = 1 then 8
             else 0 end
      -- формат: несколько подходящих (pref_formats), иначе старое одиночное поле
      + case when cardinality(p.pref_formats) > 0 then
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
