-- Защита от автооткликов (план 2.5.2): не больше 15 откликов за последние 24 часа.
-- На hh.ru боты рассылают по 200–500 откликов в сутки; здесь каждый отклик — с письмом
-- под вакансию, и работодатель должен видеть осознанные отклики, а не рассылку.
-- Проверка в базе, а не только на сайте: прямой запрос к API её не обойдёт.
create or replace function public.limit_daily_applications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Отклики одного кандидата проверяются по очереди, чтобы параллельные запросы не проскочили
  perform pg_advisory_xact_lock(hashtextextended('applications:' || new.candidate_id::text, 0));
  if (select count(*) from public.applications
       where candidate_id = new.candidate_id and created_at > now() - interval '24 hours') >= 15 then
    raise exception 'apply_limit: не больше 15 откликов за сутки' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace trigger applications_daily_limit
  before insert on public.applications
  for each row execute function public.limit_daily_applications();
