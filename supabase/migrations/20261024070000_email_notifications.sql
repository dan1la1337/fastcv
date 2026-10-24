-- Письма о откликах (через Resend, отправляет сборщик раз в 2 часа):
--   работодателю — сводка новых откликов на его вакансии;
--   кандидату — когда его пригласили на собеседование или отказали.
-- Отметки, что письмо ушло, — в самих откликах. Существующие отклики считаем уже
-- уведомлёнными, чтобы после выката никому не пришла пачка старых писем.
alter table public.applications
  add column if not exists employer_notified_at timestamptz,
  add column if not exists candidate_notified_status varchar;

update public.applications
   set employer_notified_at = coalesce(employer_notified_at, now()),
       candidate_notified_status = coalesce(candidate_notified_status, status);

-- Очередь писем: адреса берутся из auth.users, поэтому функция — только для сборщика
create or replace function public.pending_notifications()
returns table (kind text, application_id uuid, email text, vacancy_id uuid, vacancy_title text,
               status text, hr_message text, candidate_name text, company text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'employer_new', a.id, u.email::text, v.id, v.title, a.status::text, null, p.name, null
    from public.applications a
    join public.vacancies v on v.id = a.vacancy_id and v.employer_id is not null
    join auth.users u on u.id = v.employer_id
    left join public.profiles p on p.id = a.candidate_id
   where a.employer_notified_at is null
     and a.created_at > now() - interval '7 days'
  union all
  select 'candidate_status', a.id, u.email::text, v.id, v.title, a.status::text, a.hr_message, null,
         coalesce(v.company_name, e.name)
    from public.applications a
    join public.vacancies v on v.id = a.vacancy_id
    join auth.users u on u.id = a.candidate_id
    left join public.profiles e on e.id = v.employer_id
   where a.status in ('interview_scheduled', 'rejected')
     and a.candidate_notified_status is distinct from a.status
     and coalesce(a.hr_replied_at, a.created_at) > now() - interval '7 days'
$$;

create or replace function public.mark_notified(kind text, ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.applications a
       set employer_notified_at = case when kind = 'employer_new' then now() else a.employer_notified_at end,
           candidate_notified_status = case when kind = 'candidate_status' then a.status else a.candidate_notified_status end
     where a.id = any (ids)
    returning 1
  )
  select count(*)::integer from done
$$;

revoke execute on function public.pending_notifications() from public, anon, authenticated;
revoke execute on function public.mark_notified(text, uuid[]) from public, anon, authenticated;
grant execute on function public.pending_notifications() to service_role;
grant execute on function public.mark_notified(text, uuid[]) to service_role;
