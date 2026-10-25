-- Эталонный набор для замера точности ИИ (план, 1.3): реальные посты и правильные ответы.
-- Перед сменой модели или промпта прогоняем набор (eval_ai.py) и сравниваем по полям.
-- Тексты чужих постов в публичный репозиторий не кладём — только в базу, доступ у сборщика.
create table if not exists public.ai_golden (
  id         bigint generated always as identity primary key,
  source     text not null unique,          -- канал/номер поста
  text       text not null,
  expected   jsonb,                         -- null — ещё не размечен
  note       text,
  created_at timestamptz not null default now()
);

alter table public.ai_golden enable row level security;
revoke all on public.ai_golden from anon, authenticated;
grant all on public.ai_golden to service_role;
