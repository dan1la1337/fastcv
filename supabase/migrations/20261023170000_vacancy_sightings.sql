-- Индекс свежести (план 2.5.1): где и когда вакансия появлялась.
-- Сборщик записывает каждое появление вакансии в канале — и первое, и повторы в других
-- каналах, которые раньше просто отбрасывал как дубли. По ним на карточке видно, когда
-- вакансию впервые заметили и во скольких каналах её публикуют (основа детектора
-- «вакансий-призраков», план 2.5.2).
create table if not exists public.vacancy_sightings (
  source_post text primary key,                 -- «канал/id поста»
  vacancy_id  uuid not null references public.vacancies (id) on delete cascade,
  channel     text not null,
  posted_at   timestamptz,                      -- когда вышел пост
  seen_at     timestamptz not null default now()
);

create index if not exists vacancy_sightings_vacancy_idx on public.vacancy_sightings (vacancy_id);

-- Только для сборщика: сайт читает итог из колонок vacancies
alter table public.vacancy_sightings enable row level security;
grant select, insert, update on public.vacancy_sightings to service_role;

alter table public.vacancies
  add column if not exists first_seen_at timestamptz,
  add column if not exists channels_count integer not null default 1;

create or replace function public.refresh_vacancy_freshness()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.vacancies v
     set first_seen_at = s.first_seen,
         channels_count = greatest(s.channels, 1)
    from (select min(coalesce(posted_at, seen_at)) as first_seen, count(distinct lower(channel)) as channels
            from public.vacancy_sightings where vacancy_id = new.vacancy_id) s
   where v.id = new.vacancy_id;
  return null;
end;
$$;

create or replace trigger vacancy_sightings_freshness
  after insert on public.vacancy_sightings
  for each row execute function public.refresh_vacancy_freshness();

-- История, которая уже есть: пост, из которого сохранена вакансия
insert into public.vacancy_sightings (source_post, vacancy_id, channel, posted_at, seen_at)
select v.source_post, v.id, split_part(v.source_post, '/', 1), v.posted_at, v.created_at
  from public.vacancies v
 where v.source_post is not null
on conflict (source_post) do nothing;

-- Вакансии без ссылки на пост (старый сборщик, прямые работодатели)
update public.vacancies
   set first_seen_at = coalesce(posted_at, created_at)
 where first_seen_at is null;
