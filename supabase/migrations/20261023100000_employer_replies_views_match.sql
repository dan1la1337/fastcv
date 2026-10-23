-- Кабинет работодателя: ответ кандидату, просмотры вакансии, совпадение откликов.

-- Текст ответа работодателя (приглашение или отказ). Менять отклик работодатель
-- по-прежнему может только в части статуса и ответа (триггер prevent_application_tamper).
alter table public.applications
  add column if not exists hr_message text
    constraint applications_hr_message_length check (char_length(hr_message) <= 2000);

-- Просмотры страницы вакансии: воронка «просмотры → отклики → приглашения».
alter table public.vacancies
  add column if not exists views_count integer not null default 0;

-- Засчитать просмотр. Работает и без входа; свои просмотры работодатель не накручивает.
create or replace function public.register_vacancy_view(vacancy uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.vacancies
     set views_count = views_count + 1
   where id = vacancy
     and archived_at is null
     and (employer_id is null or employer_id is distinct from (select auth.uid()));
$$;

revoke execute on function public.register_vacancy_view(uuid) from public;
grant execute on function public.register_vacancy_view(uuid) to anon, authenticated;

-- Совпадение откликов с вакансией для её работодателя (та же оценка, что видит кандидат).
create or replace function public.my_application_matches()
returns table (application_id uuid, score integer, matched jsonb, missing jsonb)
language sql
stable
set search_path = ''
as $$
  select a.id, (m ->> 'score')::int, m -> 'matched', m -> 'missing'
  from public.applications a
  join public.vacancies v on v.id = a.vacancy_id and v.employer_id = (select auth.uid())
  join public.profiles p on p.id = a.candidate_id
  cross join lateral public.vacancy_match(v, p) m
$$;

revoke execute on function public.my_application_matches() from public, anon;
grant execute on function public.my_application_matches() to authenticated;
