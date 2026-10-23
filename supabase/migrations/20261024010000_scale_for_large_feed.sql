-- Лента вырастает до десятков тысяч вакансий («Работа России»). Две вещи, которые
-- считали «по всему»:
-- 1) подборка «Для вас» оценивала каждую вакансию — теперь 2 000 самых свежих из
--    направлений кандидата (или всех, если направления не выбраны);
-- 2) счётчики /jobs читали строки на клиент — теперь агрегат в базе.
create index if not exists vacancies_direction_recent_idx
  on public.vacancies (direction, created_at desc) where archived_at is null;

create or replace function public.recommended_vacancies(page_size integer default 30, page integer default 0)
returns table (id uuid, score integer, matched jsonb, missing jsonb)
language sql
stable
set search_path = ''
as $$
  with me as (
    select p from public.profiles p where p.id = (select auth.uid()) and p.role = 'candidate'
  ),
  pool as (
    select v from public.vacancies v, me
     where v.archived_at is null
       and (cardinality((me.p).pref_directions) = 0 or v.direction = any ((me.p).pref_directions))
       and not exists (
         select 1 from public.vacancy_marks h
         where h.user_id = (me.p).id and h.vacancy_id = v.id and h.kind = 'hidden')
     order by v.created_at desc
     limit 2000
  )
  select (pool.v).id, (m ->> 'score')::int as score, m -> 'matched', m -> 'missing'
  from pool, me
  cross join lateral public.vacancy_match(pool.v, me.p) m
  order by score desc, coalesce((pool.v).posted_at, (pool.v).created_at) desc, (pool.v).id
  limit least(greatest(page_size, 1), 50) offset greatest(page, 0) * least(greatest(page_size, 1), 50)
$$;

create or replace view public.direction_counts
with (security_invoker = true) as
select direction, count(*)::integer as vacancies
  from public.vacancies
 where archived_at is null and direction is not null
 group by direction;

grant select on public.direction_counts to anon, authenticated;
