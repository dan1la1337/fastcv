-- Метрики продукта для владельца: одна функция, доступная только администраторам.
-- Список администраторов — таблица app_admins (почта); заполняется вручную в SQL Editor,
-- в репозиторий адреса не попадают. Прямого доступа к таблице нет ни у кого из API.

create table if not exists public.app_admins (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins
    where email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  )
$$;

create or replace function public.admin_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Только для администраторов' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'vacancies_active', (select count(*) from public.vacancies where archived_at is null),
    'vacancies_total', (select count(*) from public.vacancies),
    -- Новые вакансии по дням за 14 дней (по московскому времени), с нулями в пустые дни
    'vacancies_by_day', (
      select jsonb_agg(jsonb_build_object('day', d::date, 'external', coalesce(e, 0), 'internal', coalesce(i, 0)) order by d)
      from generate_series((now() at time zone 'Europe/Moscow')::date - 13, (now() at time zone 'Europe/Moscow')::date, interval '1 day') d
      left join (
        select (created_at at time zone 'Europe/Moscow')::date as day,
               count(*) filter (where source_type = 'external') as e,
               count(*) filter (where source_type = 'internal') as i
        from public.vacancies
        where created_at > now() - interval '15 days'
        group by 1
      ) c on c.day = d::date
    ),
    'by_direction', (
      select jsonb_agg(jsonb_build_object('direction', direction, 'count', n) order by n desc)
      from (select coalesce(direction, 'other') as direction, count(*) as n
            from public.vacancies where archived_at is null group by 1) x
    ),
    'channels_week', (
      select jsonb_agg(jsonb_build_object('channel', channel, 'count', n) order by n desc)
      from (select split_part(source_post, '/', 1) as channel, count(*) as n
            from public.vacancies
            where source_type = 'external' and source_post is not null and created_at > now() - interval '7 days'
            group by 1 order by 2 desc limit 15) x
    ),
    'channels_active', (select count(*) from public.channels where is_active),
    'users_total', (select count(*) from public.profiles),
    'candidates', (select count(*) from public.profiles where role = 'candidate'),
    'employers', (select count(*) from public.profiles where role = 'employer'),
    'users_week', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'profiles_with_prefs', (select count(*) from public.profiles where role = 'candidate' and cardinality(pref_directions) > 0),
    'applications_total', (select count(*) from public.applications),
    'applications_week', (select count(*) from public.applications where created_at > now() - interval '7 days'),
    'invitations_total', (select count(*) from public.applications where status = 'interview_scheduled'),
    'views_total', (select coalesce(sum(views_count), 0) from public.vacancies),
    'letters_week', (select count(*) from public.ai_usage where kind = 'cover_letter' and created_at > now() - interval '7 days'),
    'ai_calls_week', (select count(*) from public.ai_usage where created_at > now() - interval '7 days')
  );
end;
$$;

revoke execute on function public.is_app_admin() from public, anon;
revoke execute on function public.admin_metrics() from public, anon;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.admin_metrics() to authenticated;
