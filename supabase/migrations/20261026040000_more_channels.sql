-- Ещё ИТ-каналы для слабых направлений (фронтенд, геймдев, мобильная разработка).
-- Отобраны пробным обходом t.me/s 26.10 из подборки refni.ru: лента открывается,
-- посты на этой неделе, в постах вакансии. theyseeku_it — ИТ-ветка уже подключённого
-- theyseeku; jobscode_infull — зеркало тех же постов, его не берём.
insert into public.channels (username, category) values
  ('theyseeku_it', 'general'),
  ('rabotafrontend', 'frontend'),
  ('runello_rus_html', 'frontend'),
  ('runello_rus_c', 'backend'),
  ('runello_rus_c20', 'backend'),
  ('uejobs', 'gamedev'),
  ('ue_pub', 'gamedev'),
  ('dartlang_jobs', 'mobile'),
  ('hireproproduct', 'product'),
  ('choicy_work', 'general'),
  ('it_vac', 'general')
on conflict (username) do nothing;
