-- Направления не только для IT и digital: «Работа России» и новые каналы приносят юристов,
-- врачей, водителей, строителей, рабочих и т. д. — раньше всё это было «Другое».
-- Новые направления (раздел «Другие профессии» в интерфейсе):
--   legal, medicine, logistics, construction, production, hospitality, government, office, management

alter table public.vacancies drop constraint if exists vacancies_direction_check;
alter table public.vacancies add constraint vacancies_direction_check check (direction in (
  'backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml', 'analytics', 'security',
  'gamedev', 'design', 'product', 'marketing', 'content', 'sales', 'hr', 'support', 'finance',
  'education', 'legal', 'medicine', 'logistics', 'construction', 'production', 'hospitality',
  'government', 'office', 'management', 'other'));

alter table public.profiles drop constraint if exists profiles_pref_directions_check;
alter table public.profiles add constraint profiles_pref_directions_check check (
  cardinality(pref_directions) <= 5 and pref_directions <@ array[
    'backend', 'frontend', 'fullstack', 'mobile', 'qa', 'devops', 'data_ml', 'analytics', 'security',
    'gamedev', 'design', 'product', 'marketing', 'content', 'sales', 'hr', 'support', 'finance',
    'education', 'legal', 'medicine', 'logistics', 'construction', 'production', 'hospitality',
    'government', 'office', 'management', 'other']::text[]);

-- Порядок правил важен. Новые профессии стоят до «поддержки» и «бэкенда»: иначе
-- «Электромонтёр по обслуживанию» уходил в поддержку, а «Полицейский мобильного взвода» —
-- в мобильную разработку. «мобильн» теперь только с начала слова («автомобильного» — не оно).
create or replace function public.vacancy_direction(title text, stack jsonb default null)
returns text language sql immutable set search_path = '' as $$
  select case
    when t ~* 'охран\w* труда' then 'production'
    when t ~* '(полицейск|полиции|следовател|прокурор|дознавател|участков\w* уполномоч|госслужащ|государственн\w* (гражданск\w* )?служ|военнослужащ|военн\w* служб|служб\w* по контракту|пожарн|спасател|охранник|\mохран[аы]\M|сторож|вахт[её]р|судебн\w* пристав|таможен|инспектор(?! по кадр))' then 'government'
    when t ~* '(преподават|учител|педагог|воспитател)' then 'education'
    when t ~* '(безопасност|security|pentest|пентест|appsec|devsecops|\msoc\M|antifraud|антифрод)' then 'security'
    when t ~* '(\mqa\M|\maqa\M|тестировщ|tester|тестирован|quality assurance|sdet)' then 'qa'
    when t ~* '(\munity\M|unreal|gamedev|геймдизайн|game|\mигров|\mlevel )' then 'gamedev'
    when t ~* '(дизайн|design|\mui\M|\mux\M|motion|моушн|иллюстратор|художник|artist|аниматор|animator|\m[23]d\M|арт-директор|art director|creative director)' then 'design'
    when t ~* '(devops|\msre\M|site reliability|инфраструктур|системн\w* администратор|сисадмин|\madmin|platform engineer|\mdba\M|администратор баз)' then 'devops'
    when t ~* '(data scien|scientist|data[- ]engineer|data integration|machine learning|\mml\M|\mml-|\mai\M|\mai-|\mии\M|\mllm|нейросет|data engineer|инженер данных|computer vision|\mcv\M|\mnlp\M|deep learning|\mdwh\M|\metl\M|mlops|prompt|robotics)' then 'data_ml'
    when t ~* '(аналитик|analyst|analytics)' then 'analytics'
    when t ~* '(android|\mios\M|\mswift|flutter|react native|mobile|\mмобильн)' then 'mobile'
    when t ~* '(fullstack|full-stack|full stack|фулстек|фуллстек)' then 'fullstack'
    when t ~* '(frontend|front-end|front end|фронтенд|фронт-энд|верстальщик|верстк|лендинг|\mreact\M|\mvue|angular)' then 'frontend'
    when t ~* '(юрист|юрисконсульт|адвокат|нотариус|правов\w* (отдел|управлен|департамент|поддержк)|legal|lawyer|\mпомощник судьи|секретар\w* судебн)' then 'legal'
    when t ~* '(\mврач|медсестр|медицинск\w* сестр|медицинск\w* брат|медбрат|фельдшер|фармацевт|провизор|санитар|акушер|стоматолог|терапевт|хирург|педиатр|невролог|рентген|лаборант|ветеринар|массажист|сиделк|младш\w* медицинск|медицинск\w* регистратор)' then 'medicine'
    when t ~* '(повар|официант|бармен|бариста|горничн|кондитер|пекар|хостес|сомелье|шеф-повар|кухонн|посудомо|гостиниц|отел[ья]\M|ресторан|\mгид\M|экскурсовод|туризм|туристическ)' then 'hospitality'
    when t ~* '(\mводител|курьер|логист|экспедитор|кладовщ|комплектовщ|грузчик|склад|диспетчер|дальнобой|таксист|logist|driver|courier|warehouse|перевоз|доставк)' then 'logistics'
    when t ~* '(строител|прораб|монтажник|каменщик|штукатур|маляр|плиточник|бетонщик|арматурщик|сметчик|геодезист|кровельщик|риелтор|риэлтор|недвижимост|отделочник|\mгип\M|главн\w* инженер\w* проект)' then 'construction'
    when t ~* '(слесар|токар|фрезеровщ|сварщ|электромонт|электрик|наладчик|станочник|оператор (станк|линии|производств|котельн|чпу|установ)|технолог|механик|мастер (участка|цеха|смены)|рабоч|\mшве[яи]|упаковщ|аппаратчик|сборщик|фасовщ|дворник|уборщ|сантехник|машинист|тракторист|агроном|зоотехник|животновод|энергетик|конструктор|кочегар|оператор (кот|газ)|инженер-(механик|энергетик|электрик|теплотехник|проектировщик|конструктор|технолог))' then 'production'
    when t ~* '(поддержк|support|helpdesk|help desk|оператор|call-центр|колл-центр|контакт-центр|customer success|техподдерж|клиентского сервиса|обслуживани)' then 'support'
    when t ~* '(маркет|marketing|\msmm|\mсмм|\mseo|\mpr\M|\mpr-|таргет|реклам|бренд|brand|reels|рилс|медиабай|медиаплан|трафик|traffic|growth|\mcmo\M|директолог|контекстолог|google ads|директ\M|продвиж|influence|инфлюенс|\mugc|сторис|креатор|социальн|соцсет|instagram|tiktok|community|сообществ|linkbuild|\mpbn\M|paid media|контент|content)' then 'marketing'
    when t ~* '(редактор|editor|журналист|сценарист|\mавтор|копирайт|copywrit|писател|радиоведущ|продюсер|producer|режисс|монтаж|звукорежисс|саунд|видео|video|фотограф)' then 'content'
    when t ~* '(продаж|sales|account|аккаунт|business development|развити\w* бизнес|развити\w* партн|bizdev|\mbdm\M|закупк|снабжен|tender|тендер|торгов|клиент|партн[её]р|агент|ozon|wildberries|маркетплейс|категорийн|продав[ец]|кассир|мерчендайз)' then 'sales'
    when t ~* '(product manager|product owner|head of product|продакт|менеджер продукта|продукт-менеджер|продуктов\w* менеджер|развити\w* продукт|project manager|проджект|менеджер проект|менеджер по проект|менеджер спецпроект|руководител\w* (it |ит )?проект|scrum|agile|delivery manager|head of production|\mcpo\M|\mpm\M|\mpo\M)' then 'product'
    when t ~* '(\mhr\M|\mhr-|рекрут|recruit|персонал|talent|\mhrbp|retention|кадр)' then 'hr'
    when t ~* '(бухгалт|финанс|accountant|finance|взыскани|кредит|ипотек|страхов|рефинанс|\mбки\M|экономист|казначей)' then 'finance'
    when t ~* '(репетитор|наставник|лектор|тренер|куратор|teacher|tutor|методист)' then 'education'
    when t ~* '(генеральн\w* директор|\mceo\M|\mcoo\M|исполнительн\w* директор|коммерческ\w* директор|управляющ\w* (директор|партн)|директор (филиала|предприятия|по развитию|магазин))' then 'management'
    when t ~* '(секретар|делопроизвод|офис-менеджер|офис менеджер|ассистент руководител|помощник руководител|документовед|архивариус|администратор|делопроизводит)' then 'office'
    when t ~* '(backend|back-end|бэкенд|бекенд|python|\mjava\M|golang|\mgo\M|\mphp|ruby|\mc#|\.net|node|rust|scala|c\+\+|\m1[сc]\M|программист|разработчик|разработк|developer|engineer|инженер-программист|\mdev\M|битрикс|bitrix|wordpress|чат-бот|chatbot)' then 'backend'
    when s ~* '(android|\mios\M|swift|kotlin|flutter)' then 'mobile'
    when s ~* '(\mreact\M|\mvue|angular|typescript|javascript)' then 'frontend'
    when s ~* '(python|\mjava\M|\mgo\M|golang|php|c#|\.net|node)' then 'backend'
    when s ~* '(figma|photoshop|illustrator)' then 'design'
    else 'other'
  end
  from (select coalesce(title, '') as t, coalesce(stack::text, '') as s) x
$$;

-- Пересчитать то, что раньше ушло в «Другое» или было определено по старым правилам
-- для «Работы России» (там ИИ не участвует). Вакансии из Telegram с направлением от ИИ не трогаем.
update public.vacancies set direction = public.vacancy_direction(title, stack)
 where direction = 'other'
    or (source_post like 'trudvsem/%' and direction in ('mobile', 'security', 'support', 'education', 'content'));
