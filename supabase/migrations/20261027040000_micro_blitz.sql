-- Микро-блиц при отклике (план 1.15): работодатель задаёт к вакансии до трёх коротких
-- вопросов, кандидат отвечает на них вместе с письмом, работодатель видит ответы
-- и ИИ-выжимку (её пишет /api/blitz-summary в applications.blitz_summary).

-- Проверка — триггером, а не CHECK: CHECK при добавлении колонки прочитал бы
-- всю большую таблицу вакансий под эксклюзивной блокировкой.
alter table public.vacancies add column if not exists blitz_questions jsonb not null default '[]'::jsonb;

alter table public.applications
  add column if not exists blitz_answers jsonb not null default '[]'::jsonb,
  add column if not exists blitz_summary text;

create or replace function public.check_blitz_questions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cleaned jsonb;
begin
  if tg_op = 'UPDATE' and new.blitz_questions is not distinct from old.blitz_questions then
    return new;
  end if;
  if new.employer_id is null then
    new.blitz_questions := '[]'::jsonb;
    return new;
  end if;
  if jsonb_typeof(new.blitz_questions) is distinct from 'array' then
    raise exception 'blitz: вопросы — список' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(btrim(q)), '[]'::jsonb) into cleaned
    from jsonb_array_elements_text(new.blitz_questions) q
   where btrim(q) <> '';
  if jsonb_array_length(cleaned) > 3 then
    raise exception 'blitz: не больше трёх вопросов' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(cleaned) q where char_length(q) > 200) then
    raise exception 'blitz: вопрос длиннее 200 символов' using errcode = '22023';
  end if;
  new.blitz_questions := cleaned;
  return new;
end;
$$;
revoke execute on function public.check_blitz_questions() from public, anon, authenticated;

create or replace trigger vacancies_check_blitz_questions
  before insert or update on public.vacancies
  for each row execute function public.check_blitz_questions();

-- Кандидат присылает ответы списком строк; база сверяет их с вопросами вакансии
-- и хранит парами {q, a} — так ответы остаются понятными, даже если вопросы потом поменяют.
create or replace function public.prepare_blitz_answers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  questions jsonb;
  answers jsonb := coalesce(new.blitz_answers, '[]'::jsonb);
  result jsonb := '[]'::jsonb;
  i integer;
  a text;
begin
  new.blitz_summary := null;
  select coalesce(v.blitz_questions, '[]'::jsonb) into questions from public.vacancies v where v.id = new.vacancy_id;
  questions := coalesce(questions, '[]'::jsonb);
  if jsonb_array_length(questions) = 0 then
    new.blitz_answers := '[]'::jsonb;
    return new;
  end if;
  if jsonb_typeof(answers) is distinct from 'array' or jsonb_array_length(answers) <> jsonb_array_length(questions) then
    raise exception 'blitz: ответьте на все вопросы работодателя' using errcode = '22023';
  end if;
  for i in 0 .. jsonb_array_length(questions) - 1 loop
    a := btrim(coalesce(answers ->> i, ''));
    if a = '' then
      raise exception 'blitz: ответьте на все вопросы работодателя' using errcode = '22023';
    end if;
    if char_length(a) > 1000 then
      raise exception 'blitz: ответ длиннее 1000 символов' using errcode = '22023';
    end if;
    result := result || jsonb_build_array(jsonb_build_object('q', questions ->> i, 'a', a));
  end loop;
  new.blitz_answers := result;
  return new;
end;
$$;
revoke execute on function public.prepare_blitz_answers() from public, anon, authenticated;

create or replace trigger applications_prepare_blitz_answers
  before insert on public.applications
  for each row execute function public.prepare_blitz_answers();

-- Ответы кандидата работодатель не правит (выжимку — может, это его заметка)
create or replace function public.prevent_application_tamper()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null and (
       new.id, new.vacancy_id, new.candidate_id, new.cover_letter, new.created_at, new.blitz_answers
     ) is distinct from (
       old.id, old.vacancy_id, old.candidate_id, old.cover_letter, old.created_at, old.blitz_answers
     ) then
    raise exception 'В отклике можно менять только статус';
  end if;
  return new;
end;
$$;

alter table public.applications drop constraint if exists applications_blitz_summary_length;
alter table public.applications add constraint applications_blitz_summary_length check (char_length(blitz_summary) <= 1500);
