-- Микро-блиц: ответы кандидата (blitz_answers) работодатель не правит с 20261027040000.
-- ИИ-выжимку (blitz_summary) пишет /api/blitz-summary сессией работодателя, и только
-- пока её нет; теперь база тоже разрешает лишь первую запись: сохранённую выжимку
-- работодатель не переписывает и не стирает. Сервисные запросы (auth.uid() не задан)
-- по-прежнему меняют что угодно.
create or replace function public.prevent_application_tamper()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and (
       (new.id, new.vacancy_id, new.candidate_id, new.cover_letter, new.created_at, new.blitz_answers)
         is distinct from
       (old.id, old.vacancy_id, old.candidate_id, old.cover_letter, old.created_at, old.blitz_answers)
       or (old.blitz_summary is not null and new.blitz_summary is distinct from old.blitz_summary)
     ) then
    raise exception 'В отклике можно менять только статус';
  end if;
  return new;
end;
$$;
