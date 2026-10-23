-- Явные права на таблицы.
--
-- В этом проекте Supabase новые таблицы схемы public больше не получают права для
-- anon / authenticated / service_role автоматически (только REFERENCES, TRIGGER,
-- TRUNCATE). Из-за этого таблицы, созданные после базовой схемы, оказались закрыты
-- даже там, где правила RLS их открывают:
--   vacancy_marks — избранное и скрытые вакансии не сохранялись;
--   cover_letters — кэш сопроводительных писем не работал (писали заново каждый раз);
--   app_settings  — бот не мог сохранить своё имя и offset, профиль — прочитать имя бота.
--
-- Здесь права выдаются явно — ровно под действующие правила RLS. Для таблиц базовой
-- схемы это ничего не меняет на рабочей базе (права там уже есть), но фиксирует их в
-- миграциях: тестовая база и новые окружения получают то же самое.
-- Только grant, ни одного revoke: скрипт безопасно применять повторно.

-- Базовая схема: на рабочей базе у этих таблиц полные права (выданы автоматически
-- при создании), доступ ограничивают правила RLS. Повторяем это явно — без изменений.
grant all on public.vacancies, public.profiles, public.applications, public.channels, public.companies
  to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to service_role;

-- ai_usage и app_admins прав не получают намеренно: с ними работают только функции
-- security definer (consume_ai_quota, is_app_admin, admin_metrics).

-- Таблицы, созданные после базовой схемы
grant select, insert, update, delete on public.vacancy_marks to authenticated;
grant select, insert, update on public.cover_letters to authenticated;
grant select on public.app_settings to anon, authenticated;
grant select, insert, update on public.app_settings to service_role;
