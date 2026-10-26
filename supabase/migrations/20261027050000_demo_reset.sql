-- Сброс демо одной командой (план 1.16): возвращает два демо-аккаунта — кандидата и
-- работодателя — в исходное состояние перед показом. Вызывает только сервис
-- (скрипт demo_reset.py или кнопка в Actions); аккаунты создаются заранее обычной регистрацией.
create or replace function public.reset_demo(candidate uuid, employer uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  company text := 'Северный код (демо)';
  apps integer;
  vacs integer;
begin
  if (select role from public.profiles where id = candidate) is distinct from 'candidate' then
    raise exception 'demo: % — не кандидат', candidate using errcode = '22023';
  end if;
  if (select role from public.profiles where id = employer) is distinct from 'employer' then
    raise exception 'demo: % — не работодатель', employer using errcode = '22023';
  end if;

  -- 1. Следы прошлого показа: отклики (с оценками), письма, отметки, расход лимитов ИИ
  delete from public.applications
   where candidate_id = candidate
      or vacancy_id in (select id from public.vacancies where employer_id = employer);
  get diagnostics apps = row_count;
  delete from public.cover_letters where user_id = candidate;
  delete from public.vacancy_marks where user_id = candidate;
  delete from public.vacancy_closed_reports where user_id in (candidate, employer);
  delete from public.ai_usage where user_id in (candidate, employer);
  delete from public.vacancies where employer_id = employer;
  get diagnostics vacs = row_count;

  -- 2. Профиль кандидата: middle Python-разработчик, ищет удалёнку
  update public.profiles set
    name = 'Анна Смирнова',
    description = 'Python-разработчик, 3 года коммерческой разработки. Делала бэкенд маркетплейса на Django: '
      || 'REST API для мобильного приложения, очереди на Celery и Redis, оптимизация запросов к PostgreSQL '
      || '(отчёты ускорились в 6 раз). Пишу тесты на pytest, настраивала CI и деплой в Docker.',
    skills = '["Python", "Django", "PostgreSQL", "Docker", "Redis", "Celery", "REST API", "Git"]'::jsonb,
    experience_years = 3,
    pref_level = 'middle',
    pref_directions = array['backend'],
    pref_formats = array['remote'],
    pref_city = null,
    pref_salary = 250000
  where id = candidate;

  -- 3. Работодатель и три свежие вакансии: первая — под демо-кандидата, с микро-блицем
  update public.profiles set name = company where id = employer;
  insert into public.vacancies
    (title, description, company_name, source_type, employer_id, salary_min, salary_max, salary_currency,
     is_remote, work_format, level, direction, stack, blitz_questions, posted_at, first_seen_at)
  values
    ('Python-разработчик (Middle)',
     'Развиваем сервис бронирования для сети клиник: 40 тысяч записей в день. Нужен разработчик в команду бэкенда. '
       || 'Задачи: новые API для мобильного приложения, интеграции с медицинскими системами, ускорение отчётов. '
       || 'Стек: Python, Django, PostgreSQL, Celery, Redis, Docker. Код-ревью, автотесты, релизы каждую неделю.',
     company, 'internal', employer, 220000, 300000, 'RUB', true, 'remote', 'middle', 'backend',
     '["Python", "Django", "PostgreSQL", "Celery", "Redis", "Docker"]'::jsonb,
     '["Какой самый нагруженный сервис вы делали и что в нём ускоряли?", "Когда готовы выйти на работу?"]'::jsonb,
     now(), now()),
    ('Frontend-разработчик (React)',
     'Делаем личный кабинет пациента: запись к врачу, анализы, оплата. Нужен фронтендер на React и TypeScript. '
       || 'Next.js, дизайн-система в Figma, тесты на Playwright.',
     company, 'internal', employer, 200000, 270000, 'RUB', true, 'remote', 'middle', 'frontend',
     '["React", "TypeScript", "Next.js", "Playwright"]'::jsonb, '[]'::jsonb, now() - interval '1 hour', now() - interval '1 hour'),
    ('QA-инженер (автотесты)',
     'Ищем инженера по тестированию: автотесты API на pytest, end-to-end на Playwright, нагрузочные тесты.',
     company, 'internal', employer, 150000, 200000, 'RUB', false, 'hybrid', 'junior', 'qa',
     '["Python", "pytest", "Playwright", "SQL"]'::jsonb, '[]'::jsonb, now() - interval '2 hours', now() - interval '2 hours');

  return jsonb_build_object('applications_removed', apps, 'vacancies_replaced', vacs, 'vacancies_created', 3);
end;
$$;
revoke all on function public.reset_demo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reset_demo(uuid, uuid) to service_role;
