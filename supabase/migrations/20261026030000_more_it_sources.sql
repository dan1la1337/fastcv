-- Больше вакансий по слабым ИТ-направлениям (devops, мобильная разработка, QA, руководство,
-- фронтенд, фулстек, геймдев). 26.10 их было 37–118 при цели от 250 на направление.

-- 1. История каналов: сборщик дочитывает посты за последние 30 дней (столько вакансия живёт
--    в ленте). history_before — с какого поста продолжать (?before=), 0 — история дочитана,
--    null — ещё не начинали. Раньше у нового канала брались только 10 последних постов.
alter table public.channels add column if not exists history_before bigint;

-- 2. Направление по названию: ИТ-руководство (CTO, руководитель разработки, директор по ИТ)
--    теперь management, а не backend; больше признаков фронтенда (JavaScript/TypeScript без
--    Node, Next.js), DevOps (Linux, Kubernetes, системный и сетевой инженер), мобильной
--    разработки (KMP), QA (автотесты) и геймдева (игры, Godot). Тимлид одной команды —
--    по специализации, как раньше.
create or replace function public.vacancy_direction(title text, stack jsonb default null)
returns text language sql immutable set search_path = '' as $$
  select case
    when t ~* 'охран\w* труда' then 'production'
    when t ~* '(полицейск|полиции|следовател|прокурор|дознавател|участков\w* уполномоч|госслужащ|государственн\w* (гражданск\w* )?служ|военнослужащ|военн\w* служб|служб\w* по контракту|пожарн|спасател|охранник|\mохран[аы]\M|сторож|вахт[её]р|судебн\w* пристав|таможен|инспектор(?! по кадр)|оперуполномоч|оперативн\w* дежурн|\mстрел[оо]к|командир (отделен|взвод|роты)|кинолог)' then 'government'
    when t ~* '(преподават|учител|педагог|воспитател)' then 'education'
    when t ~* '(\mcto\M|\mcio\M|\mcdo\M|\mcpto\M|\mvp\M of engineering|head of (engineering|development|it\M|technology|r&d|software)|engineering manager|директор (по|департамента) (ит|it|информационн|цифров|разработк|технолог)|\mit-директор|\mит-директор|технически\w* директор|руководител\w* (разработки|it\M|ит\M|it-|ит-|(отдела|направления|департамента|подразделения|центра|группы|службы|управления) (разработки|ит\M|it\M|информационн|программн|тестирования|автоматизации))|начальник (отдела|управления|службы) (ит\M|it\M|информационн|автоматизац|разработки))' and t !~* '(безопасн|security)' then 'management'
    when t ~* '(безопасност|security|pentest|пентест|appsec|devsecops|\msoc\M|antifraud|антифрод)' then 'security'
    when t ~* '(\mqa\M|\maqa\M|\mqa-|тестировщ|tester|тестирован|quality assurance|sdet|автотест|test engineer|тест-дизайн)' then 'qa'
    when t ~* '(\munity\M|unreal|gamedev|геймдев|гейм-|геймдизайн|game|\mигров|\mигр[ауые]?\M|\mlevel |godot|cocos|\mgdd\M)' then 'gamedev'
    when t ~* '(дизайн|design|\mui\M|\mux\M|motion|моушн|иллюстратор|художник|artist|аниматор|animator|\m[23]d\M|арт-директор|art director|creative director)' then 'design'
    when t ~* '(devops|\msre\M|site reliability|инфраструктур|системн\w* администратор|сисадмин|\madmin|platform engineer|\mdba\M|администратор баз|\mlinux|kubernetes|\mk8s|облачн|cloud engineer|сетев\w* инженер|network engineer|системн\w* инженер|администратор (сет|сервер|linux|windows))' then 'devops'
    when t ~* '(data scien|scientist|data[- ]engineer|data integration|machine learning|\mml\M|\mml-|\mai\M|\mai-|\mии\M|\mllm|нейросет|data engineer|инженер данных|computer vision|\mcv\M|\mnlp\M|deep learning|\mdwh\M|\metl\M|mlops|prompt|robotics|\mds\M|\mds-|дата-сайентист|датасайентист)' then 'data_ml'
    when t ~* '(аналитик|analyst|analytics)' then 'analytics'
    when t ~* '(android|\mios\M|\mswift|flutter|react native|mobile|\mмобильн|\mkmp\M|kotlin multiplatform|xamarin|\mmaui\M)' then 'mobile'
    when t ~* '(fullstack|full-stack|full stack|фулстек|фуллстек|фулл-стек|фул-стек)' then 'fullstack'
    when t ~* '(frontend|front-end|front end|фронтенд|фронт-энд|фронтэнд|верстальщик|верстк|лендинг|\mreact\M|\mvue|angular|next\.js|nuxt|svelte|ui-разработчик)' then 'frontend'
    when t ~* '(javascript|typescript|\mjs\M|\mts\M)' and t !~* '(node|backend|бэкенд|бекенд|nest)' then 'frontend'
    when t ~* '(юрист|юрисконсульт|адвокат|нотариус|правов\w* (отдел|управлен|департамент|поддержк)|legal|lawyer|\mпомощник судьи|секретар\w* судебн)' then 'legal'
    when t ~* '(\mврач|медсестр|медицинск\w* сестр|медицинск\w* брат|медбрат|фельдшер|фармацевт|провизор|санитар|акушер|стоматолог|терапевт|хирург|педиатр|невролог|рентген|лаборант|ветеринар|массажист|сиделк|младш\w* медицинск|медицинск\w* регистратор|психолог|психотерапевт|медицинск\w* (статистик|психолог|дезинфектор|оптик))' then 'medicine'
    when t ~* '(повар|официант|бармен|бариста|горничн|кондитер|пекар|хостес|сомелье|шеф-повар|кухонн|посудомо|буфетчи|гостиниц|отел[ья]\M|ресторан|\mгид\M|экскурсовод|туризм|туристическ)' then 'hospitality'
    when t ~* '(\mводител|курьер|логист|экспедитор|кладовщ|комплектовщ|грузчик|склад|диспетчер|дальнобой|таксист|logist|driver|courier|warehouse|перевоз|доставк|почтальон|сортировщ|транспортировщ|составител\w* поезд|проводник)' then 'logistics'
    when t ~* '(строител|прораб|монтажник|каменщик|штукатур|маляр|плиточник|бетонщик|арматурщик|сметчик|геодезист|кровельщик|риелтор|риэлтор|недвижимост|отделочник|плотник|столяр|изолировщ|стропальщ|\mгип\M|главн\w* инженер\w* проект)' then 'construction'
    when t ~* '(слесар|токар|фрезеровщ|сварщ|электромонт|электрик|наладчик|станочник|оператор (станк|линии|производств|котельн|чпу|установ)|технолог|механик|мастер (участка|цеха|смены)|рабоч|\mшве[яи]|упаковщ|аппаратчик|сборщик|фасовщ|дворник|уборщ|сантехник|машинист|тракторист|агроном|зоотехник|животновод|энергетик|конструктор|кочегар|монт[её]р|обработчик|мойщик|механизатор|контрол[её]р (отк|качеств|технич)|оператор (кот|газ)|инженер-(механик|энергетик|электрик|теплотехник|проектировщик|конструктор|технолог))' then 'production'
    when t ~* '(поддержк|support|helpdesk|help desk|оператор|call-центр|колл-центр|контакт-центр|customer success|техподдерж|клиентского сервиса|обслуживани)' then 'support'
    when t ~* '(product manager|product owner|head of product|продакт|менеджер продукта|продукт-менеджер|продуктов\w* менеджер|развити\w* продукт|project manager|проджект|менеджер проект|менеджер по проект|менеджер спецпроект|руководител\w* (it |ит )?проект|scrum|agile|delivery manager|head of production|\mcpo\M|\mpm\M|\mpo\M|product lead|руководител\w* продукт|продуктов\w* (направлен|команд|юнит))' then 'product'
    when t ~* '(маркет|marketing|\msmm|\mсмм|\mseo|\mpr\M|\mpr-|таргет|реклам|бренд|brand|reels|рилс|медиабай|медиаплан|трафик|traffic|growth|\mcmo\M|директолог|контекстолог|google ads|директ\M|продвиж|influence|инфлюенс|\mugc|сторис|креатор|социальн|соцсет|instagram|tiktok|community|сообществ|linkbuild|\mpbn\M|paid media|контент|content)' then 'marketing'
    when t ~* '(редактор|editor|переводчик|translator|журналист|сценарист|\mавтор|копирайт|copywrit|писател|радиоведущ|продюсер|producer|режисс|монтаж|звукорежисс|саунд|видео|video|фотограф)' then 'content'
    when t ~* '(продаж|sales|account|аккаунт|business development|развити\w* бизнес|развити\w* партн|bizdev|\mbdm\M|закупк|снабжен|tender|тендер|торгов|клиент|партн[её]р|агент|ozon|wildberries|маркетплейс|категорийн|продав[ец]|кассир|мерчендайз)' then 'sales'
    when t ~* '(\mhr\M|\mhr-|рекрут|recruit|персонал|talent|\mhrbp|retention|кадр)' then 'hr'
    when t ~* '(бухгалт|финанс|accountant|finance|взыскани|кредит|ипотек|страхов|рефинанс|\mбки\M|экономист|казначей)' then 'finance'
    when t ~* '(репетитор|наставник|лектор|тренер|куратор|teacher|tutor|методист|тьютор|библиотекар|культорганизатор|музыкальн\w* руководител|концертмейстер|инструктор|логопед|дефектолог)' then 'education'
    when t ~* '(генеральн\w* директор|\mceo\M|\mcoo\M|исполнительн\w* директор|коммерческ\w* директор|управляющ\w* (директор|партн)|директор (филиала|предприятия|по развитию|магазин))' then 'management'
    when t ~* '(секретар|делопроизвод|офис-менеджер|офис менеджер|ассистент руководител|помощник руководител|документовед|архивариус|администратор|делопроизводит)' then 'office'
    when t ~* '(backend|back-end|бэкенд|бекенд|python|\mjava\M|golang|\mgo\M|\mphp|ruby|\mc#|\.net|node|rust|scala|c\+\+|\m1[сc]\M|программист|разработчик|разработк|developer|engineer|инженер-программист|\mdev\M|битрикс|bitrix|wordpress|чат-бот|chatbot|серверн|тимлид|team ?lead|техлид|tech ?lead)' then 'backend'
    when s ~* '(android|\mios\M|swift|kotlin|flutter)' then 'mobile'
    when s ~* '(\mreact\M|\mvue|angular|typescript|javascript)' then 'frontend'
    when s ~* '(python|\mjava\M|\mgo\M|golang|php|c#|\.net|node)' then 'backend'
    when s ~* '(figma|photoshop|illustrator)' then 'design'
    else 'other'
  end
  from (select coalesce(title, '') as t, coalesce(stack::text, '') as s) x
$$;

-- Пересчёт по новым правилам. Сайты компаний — целиком (там направление ставят правила).
-- Telegram — где ИИ поставил «other», а также ИТ-руководство и геймдев, которых ИИ раньше
-- относил к бэкенду. «Работу России» и SuperJob не трогаем: у них направление из рубрики.
update public.vacancies set direction = public.vacancy_direction(title, stack)
 where archived_at is null and source_post like 'career/%'
   and direction is distinct from public.vacancy_direction(title, stack);
update public.vacancies set direction = public.vacancy_direction(title, stack)
 where archived_at is null and source_kind = 'telegram' and direction = 'other'
   and public.vacancy_direction(title, stack) <> 'other';
update public.vacancies set direction = public.vacancy_direction(title, stack)
 where archived_at is null and source_kind = 'telegram' and direction in ('backend', 'product', 'design')
   and public.vacancy_direction(title, stack) in ('management', 'gamedev');

-- 3. ИТ-вакансии «Работы России» и SuperJob храним 30 дней, как вакансии из Telegram,
--    а не 2 дня и 8 часов: их немного (сотни в сутки), а без них по DevOps и руководству
--    в ленте почти пусто. Остальные профессии ротируются как раньше.
create or replace function public.prune_trudvsem(keep_days integer default 2)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
  archived integer;
begin
  with old as (
    select v.id from public.vacancies v
     where v.source_post like 'trudvsem/%'
       and coalesce(v.posted_at, v.created_at) < now() - make_interval(days => greatest(keep_days, 1))
       and (v.direction is null or v.direction not in ('backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml', 'analytics', 'security', 'gamedev', 'design', 'product', 'management')
            or coalesce(v.posted_at, v.created_at) < now() - interval '30 days')
  ),
  kept as (
    select o.id from old o
     where exists (select 1 from public.applications a where a.vacancy_id = o.id)
        or exists (select 1 from public.vacancy_marks m where m.vacancy_id = o.id)
  ),
  arch as (
    update public.vacancies set archived_at = now()
     where id in (select id from kept) and archived_at is null
    returning 1
  ),
  del as (
    delete from public.vacancies where id in (select id from old except select id from kept)
    returning 1
  )
  select (select count(*) from del), (select count(*) from arch) into removed, archived;
  return jsonb_build_object('removed', removed, 'archived', archived);
end;
$$;

create or replace function public.prune_imported(source text, keep_hours integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
  archived integer;
begin
  if source not in ('trudvsem', 'superjob') then
    raise exception 'unknown source %', source;
  end if;
  with old as (
    select v.id from public.vacancies v
     where v.source_post like source || '/%'
       and coalesce(v.posted_at, v.created_at) < now() - make_interval(hours => greatest(keep_hours, 1))
       and (v.direction is null or v.direction not in ('backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml', 'analytics', 'security', 'gamedev', 'design', 'product', 'management')
            or coalesce(v.posted_at, v.created_at) < now() - interval '30 days')
  ),
  kept as (
    select o.id from old o
     where exists (select 1 from public.applications a where a.vacancy_id = o.id)
        or exists (select 1 from public.vacancy_marks m where m.vacancy_id = o.id)
  ),
  arch as (
    update public.vacancies set archived_at = now()
     where id in (select id from kept) and archived_at is null
    returning 1
  ),
  del as (
    delete from public.vacancies where id in (select id from old except select id from kept)
    returning 1
  )
  select (select count(*) from del), (select count(*) from arch) into removed, archived;
  return jsonb_build_object('removed', removed, 'archived', archived);
end;
$$;

-- SuperJob: закрытые на сайте ИТ-вакансии убираем (сборщик раз в запуск сверяет весь
-- 30-дневный список ИТ-вакансий и передаёт id тех, что ещё открыты).
create or replace function public.prune_superjob_closed(open_ids text[], since timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.vacancies v
     where v.source_post like 'superjob/%'
       and v.direction in ('backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml', 'analytics', 'security', 'gamedev', 'design', 'product', 'management')
       and coalesce(v.posted_at, v.created_at) >= since
       and v.created_at < now() - interval '1 hour'
       and not (substr(v.source_post, 10) = any(open_ids))
       and not exists (select 1 from public.applications a where a.vacancy_id = v.id)
       and not exists (select 1 from public.vacancy_marks m where m.vacancy_id = v.id)
    returning 1
  )
  select count(*)::integer from gone;
$$;
revoke all on function public.prune_superjob_closed(text[], timestamptz) from public, anon, authenticated;
grant execute on function public.prune_superjob_closed(text[], timestamptz) to service_role;

-- 4. Новые Telegram-каналы. Отобраны пробным обходом t.me/s 26.10: лента открывается,
--    в постах вакансии, свежие посты на этой неделе.
insert into public.channels (username, category) values
  ('qa_rabota', 'qa'),
  ('devops_rabota', 'devops'),
  ('mobiledev_jobs', 'mobile'),
  ('product_jobs', 'product'),
  ('gamedevjobs', 'gamedev'),
  ('remote_jobs_ru', 'general'),
  ('sapjobrus', 'general')
on conflict (username) do nothing;
