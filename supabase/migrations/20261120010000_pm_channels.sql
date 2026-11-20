-- Telegram-каналы с вакансиями менеджеров продукта и проектов. Отобраны пробным обходом
-- t.me/s 20.11: лента открывается, посты в ноябре, в постах текст вакансии.
-- jobs_pm: вакансии PM вперемешку с рекламой (рекламу отсеет ИИ). pm_vacancy не берём:
-- в постах только ссылки на hh.ru без текста.
insert into public.channels (username, category) values
  ('product_work', 'product'),
  ('productvacancy', 'product'),
  ('jobs_pm', 'product')
on conflict (username) do nothing;
