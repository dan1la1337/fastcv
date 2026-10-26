-- Фильтр по стране в ленте. Страна вакансии — из города (справочник ниже), для вакансий
-- из Telegram без города — из ответа ИИ (поле country), для «Работы России» и SuperJob —
-- всегда Россия. Город кириллицей не из справочника — российский. Неизвестно — null:
-- такие вакансии видны только при «Все страны».

alter table public.vacancies add column if not exists country text;

-- Страна по источнику и городу; given — что сказал ИИ. Город точнее ИИ, ИИ точнее догадки.
create or replace function public.vacancy_country(city text, source_post text, given text)
returns text language sql immutable set search_path = '' as $$
  select case
    when source_post like 'trudvsem/%' or source_post like 'superjob/%' then 'Россия'
    else coalesce(
      (select v.country from (values
        ('усть-каменогорск', 'Казахстан'),
      ('нур-султан', 'Казахстан'),
      ('алма-ата', 'Казахстан'),
      ('алматы', 'Казахстан'),
      ('almaty', 'Казахстан'),
      ('астана', 'Казахстан'),
      ('astana', 'Казахстан'),
      ('шымкент', 'Казахстан'),
      ('shymkent', 'Казахстан'),
      ('караганда', 'Казахстан'),
      ('karaganda', 'Казахстан'),
      ('костанай', 'Казахстан'),
      ('актобе', 'Казахстан'),
      ('aktobe', 'Казахстан'),
      ('павлодар', 'Казахстан'),
      ('атырау', 'Казахстан'),
      ('atyrau', 'Казахстан'),
      ('актау', 'Казахстан'),
      ('aktau', 'Казахстан'),
      ('тараз', 'Казахстан'),
      ('семей', 'Казахстан'),
      ('кызылорда', 'Казахстан'),
      ('уральск', 'Казахстан'),
      ('петропавловск', 'Казахстан'),
      ('туркестан', 'Казахстан'),
      ('ташкент', 'Узбекистан'),
      ('tashkent', 'Узбекистан'),
      ('toshkent', 'Узбекистан'),
      ('самарканд', 'Узбекистан'),
      ('samarkand', 'Узбекистан'),
      ('бухара', 'Узбекистан'),
      ('bukhara', 'Узбекистан'),
      ('наманган', 'Узбекистан'),
      ('андижан', 'Узбекистан'),
      ('фергана', 'Узбекистан'),
      ('нукус', 'Узбекистан'),
      ('минск', 'Беларусь'),
      ('minsk', 'Беларусь'),
      ('гомель', 'Беларусь'),
      ('gomel', 'Беларусь'),
      ('брест', 'Беларусь'),
      ('гродно', 'Беларусь'),
      ('витебск', 'Беларусь'),
      ('могилёв', 'Беларусь'),
      ('могилев', 'Беларусь'),
      ('ереван', 'Армения'),
      ('yerevan', 'Армения'),
      ('гюмри', 'Армения'),
      ('тбилиси', 'Грузия'),
      ('tbilisi', 'Грузия'),
      ('tblisi', 'Грузия'),
      ('батуми', 'Грузия'),
      ('batumi', 'Грузия'),
      ('кутаиси', 'Грузия'),
      ('бишкек', 'Кыргызстан'),
      ('bishkek', 'Кыргызстан'),
      ('ош', 'Кыргызстан'),
      ('баку', 'Азербайджан'),
      ('baku', 'Азербайджан'),
      ('душанбе', 'Таджикистан'),
      ('dushanbe', 'Таджикистан'),
      ('худжанд', 'Таджикистан'),
      ('кишинёв', 'Молдова'),
      ('кишинев', 'Молдова'),
      ('chisinau', 'Молдова'),
      ('киев', 'Украина'),
      ('kyiv', 'Украина'),
      ('kiev', 'Украина'),
      ('харьков', 'Украина'),
      ('kharkiv', 'Украина'),
      ('одесса', 'Украина'),
      ('odesa', 'Украина'),
      ('odessa', 'Украина'),
      ('львов', 'Украина'),
      ('lviv', 'Украина'),
      ('днепр', 'Украина'),
      ('dnipro', 'Украина'),
      ('запорожье', 'Украина'),
      ('винница', 'Украина'),
      ('novi sad', 'Сербия'),
      ('нови сад', 'Сербия'),
      ('нови-сад', 'Сербия'),
      ('белград', 'Сербия'),
      ('belgrade', 'Сербия'),
      ('beograd', 'Сербия'),
      ('ниш', 'Сербия'),
      ('serbia', 'Сербия'),
      ('подгорица', 'Черногория'),
      ('будва', 'Черногория'),
      ('бар', 'Черногория'),
      ('тиват', 'Черногория'),
      ('варшава', 'Польша'),
      ('warsaw', 'Польша'),
      ('warszawa', 'Польша'),
      ('краков', 'Польша'),
      ('krakow', 'Польша'),
      ('kraków', 'Польша'),
      ('вроцлав', 'Польша'),
      ('wroclaw', 'Польша'),
      ('гданьск', 'Польша'),
      ('gdansk', 'Польша'),
      ('познань', 'Польша'),
      ('лодзь', 'Польша'),
      ('poland', 'Польша'),
      ('лимассол', 'Кипр'),
      ('лимасол', 'Кипр'),
      ('limassol', 'Кипр'),
      ('никосия', 'Кипр'),
      ('nicosia', 'Кипр'),
      ('пафос', 'Кипр'),
      ('paphos', 'Кипр'),
      ('ларнака', 'Кипр'),
      ('larnaca', 'Кипр'),
      ('кипр', 'Кипр'),
      ('cyprus', 'Кипр'),
      ('abu dhabi', 'ОАЭ'),
      ('абу-даби', 'ОАЭ'),
      ('дубай', 'ОАЭ'),
      ('dubai', 'ОАЭ'),
      ('шарджа', 'ОАЭ'),
      ('оаэ', 'ОАЭ'),
      ('uae', 'ОАЭ'),
      ('стамбул', 'Турция'),
      ('istanbul', 'Турция'),
      ('анталья', 'Турция'),
      ('antalya', 'Турция'),
      ('анкара', 'Турция'),
      ('измир', 'Турция'),
      ('берлин', 'Германия'),
      ('berlin', 'Германия'),
      ('мюнхен', 'Германия'),
      ('munich', 'Германия'),
      ('гамбург', 'Германия'),
      ('hamburg', 'Германия'),
      ('франкфурт', 'Германия'),
      ('frankfurt', 'Германия'),
      ('кёльн', 'Германия'),
      ('кельн', 'Германия'),
      ('ахен', 'Германия'),
      ('aachen', 'Германия'),
      ('renningen', 'Германия'),
      ('штутгарт', 'Германия'),
      ('дюссельдорф', 'Германия'),
      ('амстердам', 'Нидерланды'),
      ('amsterdam', 'Нидерланды'),
      ('роттердам', 'Нидерланды'),
      ('гаага', 'Нидерланды'),
      ('эйндховен', 'Нидерланды'),
      ('лондон', 'Великобритания'),
      ('london', 'Великобритания'),
      ('манчестер', 'Великобритания'),
      ('барселона', 'Испания'),
      ('barcelona', 'Испания'),
      ('мадрид', 'Испания'),
      ('madrid', 'Испания'),
      ('валенсия', 'Испания'),
      ('малага', 'Испания'),
      ('лиссабон', 'Португалия'),
      ('lisbon', 'Португалия'),
      ('порту', 'Португалия'),
      ('porto', 'Португалия'),
      ('париж', 'Франция'),
      ('paris', 'Франция'),
      ('лион', 'Франция'),
      ('прага', 'Чехия'),
      ('prague', 'Чехия'),
      ('брно', 'Чехия'),
      ('бухарест', 'Румыния'),
      ('bucharest', 'Румыния'),
      ('рига', 'Латвия'),
      ('riga', 'Латвия'),
      ('вильнюс', 'Литва'),
      ('vilnius', 'Литва'),
      ('таллин', 'Эстония'),
      ('таллинн', 'Эстония'),
      ('tallinn', 'Эстония'),
      ('хельсинки', 'Финляндия'),
      ('helsinki', 'Финляндия'),
      ('espoo', 'Финляндия'),
      ('эспоо', 'Финляндия'),
      ('рим', 'Италия'),
      ('милан', 'Италия'),
      ('milan', 'Италия'),
      ('цюрих', 'Швейцария'),
      ('zurich', 'Швейцария'),
      ('женева', 'Швейцария'),
      ('вена', 'Австрия'),
      ('vienna', 'Австрия'),
      ('софия', 'Болгария'),
      ('sofia', 'Болгария'),
      ('варна', 'Болгария'),
      ('будапешт', 'Венгрия'),
      ('budapest', 'Венгрия'),
      ('афины', 'Греция'),
      ('athens', 'Греция'),
      ('тель-авив', 'Израиль'),
      ('tel aviv', 'Израиль'),
      ('хайфа', 'Израиль'),
      ('израиль', 'Израиль'),
      ('israel', 'Израиль'),
      ('сан-франциско', 'США'),
      ('new york city', 'США'),
      ('north america', 'США'),
      ('san francisco', 'США'),
      ('mountain view', 'США'),
      ('лос-анджелес', 'США'),
      ('нью-йорк', 'США'),
      ('new york', 'США'),
      ('redmond', 'США'),
      ('lehi', 'США'),
      ('бостон', 'США'),
      ('boston', 'США'),
      ('сиэтл', 'США'),
      ('seattle', 'США'),
      ('остин', 'США'),
      ('austin', 'США'),
      ('сша', 'США'),
      ('usa', 'США'),
      ('торонто', 'Канада'),
      ('toronto', 'Канада'),
      ('ванкувер', 'Канада'),
      ('vancouver', 'Канада'),
      ('бернаби', 'Канада'),
      ('burnaby', 'Канада'),
      ('монреаль', 'Канада'),
      ('джакарта', 'Индонезия'),
      ('jakarta', 'Индонезия'),
      ('бали', 'Индонезия'),
      ('бангалор', 'Индия'),
      ('bangalore', 'Индия'),
      ('бангалуру', 'Индия'),
      ('гуанчжоу', 'Китай'),
      ('шанхай', 'Китай'),
      ('shanghai', 'Китай'),
      ('пекин', 'Китай'),
      ('шэньчжэнь', 'Китай'),
      ('хошимин', 'Вьетнам'),
      ('ханой', 'Вьетнам'),
      ('hanoi', 'Вьетнам'),
      ('бангкок', 'Таиланд'),
      ('пхукет', 'Таиланд'),
      ('мексика', 'Мексика'),
      ('мехико', 'Мексика'),
      ('lebanon', 'Ливан'),
      ('бейрут', 'Ливан'),
      ('россия', 'Россия'),
      ('рф', 'Россия'),
      ('russia', 'Россия')
      ) v(name, country) where v.name = lower(btrim(vacancy_country.city))),
      nullif(btrim(given), ''),
      case when btrim(coalesce(city, '')) ~ '^[А-ЯЁа-яё][А-ЯЁа-яё .()-]*$' then 'Россия' end,
      -- сайты российских компаний (careers.py) без города — Россия; системы найма (ats.py) — нет
      case when source_post like 'career/%' and source_post !~ '^career/(sperasoft|tripledot|jetbrains)/' then 'Россия' end)
  end
$$;

create or replace function public.set_vacancy_country()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.city is distinct from old.city or new.country is distinct from old.country then
    new.country := public.vacancy_country(new.city, new.source_post, new.country);
  end if;
  return new;
end;
$$;

-- После vacancies_normalize (имена триггеров идут по алфавиту): город уже приведён к виду
create or replace trigger vacancies_set_country
  before insert or update on public.vacancies
  for each row execute function public.set_vacancy_country();

-- Справочник стран для фильтра (как vacancy_cities), с числом вакансий
create materialized view if not exists public.vacancy_countries as
select country, count(*)::integer as vacancies
  from public.vacancies
 where archived_at is null and country is not null
 group by country;
create unique index if not exists vacancy_countries_key on public.vacancy_countries (country);
revoke all on public.vacancy_countries from anon, authenticated;
grant select on public.vacancy_countries to anon, authenticated;

-- Город в справочнике городов — со страной: выбрали страну — в списке городов только её города
drop materialized view if exists public.vacancy_cities;
create materialized view public.vacancy_cities as
select city, max(country) as country, count(*)::integer as vacancies
  from public.vacancies
 where archived_at is null and city is not null and btrim(city) <> ''
 group by city;
create unique index vacancy_cities_key on public.vacancy_cities (city);
revoke all on public.vacancy_cities from anon, authenticated;
grant select on public.vacancy_cities to anon, authenticated;

create or replace function public.refresh_feed_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  refresh materialized view concurrently public.salary_benchmarks;
  refresh materialized view concurrently public.vacancy_cities;
  refresh materialized view concurrently public.direction_counts;
  refresh materialized view concurrently public.vacancy_countries;
end;
$$;
revoke all on function public.refresh_feed_stats() from public, anon, authenticated;
grant execute on function public.refresh_feed_stats() to service_role;

-- Фильтр ленты по стране — по индексу (на проде создан заранее через create index concurrently)
create index if not exists vacancies_country_idx on public.vacancies (country) where archived_at is null;

-- Заполнение. Вакансии из Telegram без города: по зарплате в рублях — Россия (ИИ про страну
-- раньше не спрашивали). На проде — пачками, см. описание PR.
update public.vacancies set country = public.vacancy_country(city, source_post,
         case when city is null and salary_currency = 'RUB' then 'Россия' end)
 where country is null and archived_at is null;

refresh materialized view public.vacancy_countries;
refresh materialized view public.vacancy_cities;
