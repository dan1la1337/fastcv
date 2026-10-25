-- Сайты компаний: ИТ и цифровые роли — наравне с Telegram (1.0), остальное (розница банков,
-- продажи в отделениях) — ниже «Работы России» (0.85). Иначе свежие «Альфа-Агент» и
-- «Менеджер» сотнями открывают ленту по умолчанию.
-- Направление ставит триггер vacancies_normalize; этот срабатывает после него (по имени).
create or replace function public.rank_career_vacancy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source_post like 'career/%' then
    new.ranking_weight := case
      when new.direction in ('backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml',
                             'analytics', 'security', 'gamedev', 'product', 'design') then 1.0
      else 0.85 end;
  end if;
  return new;
end;
$$;

drop trigger if exists vacancies_rank on public.vacancies;
create trigger vacancies_rank
  before insert or update on public.vacancies
  for each row execute function public.rank_career_vacancy();

-- Уже собранные: несколько сотен строк
update public.vacancies set ranking_weight = case
    when direction in ('backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml',
                       'analytics', 'security', 'gamedev', 'product', 'design') then 1.0
    else 0.85 end
 where source_post like 'career/%'
   and ranking_weight is distinct from case
    when direction in ('backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml',
                       'analytics', 'security', 'gamedev', 'product', 'design') then 1.0
    else 0.85 end;
