-- Кто нанимает: продуктовая команда, аутстафф/интегратор или кадровое агентство.
-- Определяет ИИ сборщика по формулировкам поста («на проект нашего клиента», «в штат
-- продуктовой команды»). У 83% вакансий из Telegram не названа компания — тип хотя бы
-- честно говорит кандидату, с кем он будет иметь дело. null — неясно из текста.
-- Вакансии, опубликованные работодателем на FastCV, — прямой наём (source_type = 'internal').
alter table public.vacancies
  add column if not exists hiring_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vacancies_hiring_type_check') then
    alter table public.vacancies
      add constraint vacancies_hiring_type_check check (hiring_type in ('product', 'outsource', 'agency'));
  end if;
end;
$$;
