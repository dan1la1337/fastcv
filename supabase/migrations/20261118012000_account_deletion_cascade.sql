-- Удаление аккаунта (delete_my_account) падало у кандидата с откликом и у работодателя
-- с вакансией: внешние ключи applications.candidate_id и vacancies.employer_id из базовой
-- схемы не имели ON DELETE и не давали удалить профиль.
--
-- applications.candidate_id → CASCADE: отклик — данные кандидата (152-ФЗ), уходит вместе
--   с ним; следом каскадом уходят диалог, отзыв, разборы отказа и скрининга.
-- vacancies.employer_id → CASCADE: вакансия работодателя без работодателя не нужна,
--   а SET NULL выдал бы её за ничью внутреннюю вакансию.
-- applications.vacancy_id остаётся без ON DELETE: иначе работодатель, удалив вакансию,
--   стёр бы чужие отклики и отзывы кандидатов о себе. Отклики на вакансии удаляемого
--   работодателя delete_my_account удаляет явно, до профиля.
alter table public.applications drop constraint if exists applications_candidate_id_fkey;
alter table public.applications add constraint applications_candidate_id_fkey
  foreign key (candidate_id) references public.profiles (id) on delete cascade;

alter table public.vacancies drop constraint if exists vacancies_employer_id_fkey;
alter table public.vacancies add constraint vacancies_employer_id_fkey
  foreign key (employer_id) references public.profiles (id) on delete cascade;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  delete from public.applications
   where vacancy_id in (select id from public.vacancies where employer_id = me);
  delete from public.profiles where id = me;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
