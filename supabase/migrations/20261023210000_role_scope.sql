-- Проверка адекватности требований (план 2.5.2): ИИ сборщика отмечает вакансии, где на одну
-- позицию смешаны обязанности нескольких ролей, и коротко пишет, что именно смешано.
-- null — роль цельная или ИИ не уверен.
alter table public.vacancies
  add column if not exists scope_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vacancies_scope_note_length') then
    alter table public.vacancies
      add constraint vacancies_scope_note_length check (char_length(scope_note) <= 300);
  end if;
end;
$$;
