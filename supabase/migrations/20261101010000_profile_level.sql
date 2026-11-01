-- Уровень кандидата больше не выводится из лет опыта: годы — это просто годы. Уровень
-- кандидат выбирает сам или берёт оценку ИИ по резюме — вместе с объяснением, почему
-- такой уровень и что добавить в резюме. «Руковожу людьми» — отдельный факт.
alter table public.profiles add column if not exists leads_people boolean not null default false;
alter table public.profiles add column if not exists level_reason text check (char_length(level_reason) <= 1200);
-- ai — уровень поставил ИИ по резюме, manual — кандидат выбрал сам
alter table public.profiles add column if not exists level_source text check (level_source in ('ai', 'manual'));

-- Раньше lead означал «руковожу людьми»
update public.profiles set leads_people = true where pref_level = 'lead' and not leads_people;
