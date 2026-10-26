-- Подтверждение компании (план 1.11): работодатель доказывает, что владеет доменом компании,
-- TXT-записью в DNS «fastcv-verify=<код>» — как в Google Search Console. Проверяет сама база:
-- запрос к DNS-over-HTTPS Cloudflare через расширение http, без ключей и почты.
-- Подтверждённым работодателям — значок «Проверенный работодатель» на их вакансиях.

-- В локальной тестовой базе расширения http нет: там проверка DNS просто не работает
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'http') then
    create extension if not exists http with schema extensions;
  end if;
end;
$$;

alter table public.profiles
  add column if not exists company_domain text,
  add column if not exists company_verify_token text,
  add column if not exists company_verified_at timestamptz,
  add column if not exists company_checked_at timestamptz;

alter table public.vacancies add column if not exists employer_verified boolean not null default false;

-- Поля подтверждения меняют только функции ниже (и сервис): иначе любой вписал бы себе значок
create or replace function public.prevent_company_tamper()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and current_setting('fastcv.company_verify', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      new.company_domain := null; new.company_verify_token := null;
      new.company_verified_at := null; new.company_checked_at := null;
    elsif (new.company_domain, new.company_verify_token, new.company_verified_at, new.company_checked_at)
          is distinct from (old.company_domain, old.company_verify_token, old.company_verified_at, old.company_checked_at) then
      raise exception 'Подтверждение компании меняет только сервис';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger profiles_prevent_company_tamper
  before insert or update on public.profiles
  for each row execute function public.prevent_company_tamper();

-- Бесплатная почта и хостинги — не домен компании
create or replace function public.is_public_domain(domain text)
returns boolean language sql immutable set search_path = '' as $$
  select domain ~ '(^|\.)(gmail\.com|googlemail\.com|yandex\.(ru|com|by|kz)|ya\.ru|mail\.ru|bk\.ru|inbox\.ru|list\.ru|internet\.ru|rambler\.ru|outlook\.com|hotmail\.com|live\.com|icloud\.com|me\.com|proton\.me|protonmail\.com|yahoo\.com|github\.io|vercel\.app|netlify\.app|tilda\.ws|wixsite\.com|t\.me|vk\.com)$'
$$;

-- Шаг 1: работодатель называет домен, получает код для TXT-записи
create or replace function public.start_company_verification(domain text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d text := lower(btrim(regexp_replace(coalesce(domain, ''), '^(https?://)?(www\.)?([^/]+).*$', '\3')));
  code text := replace(gen_random_uuid()::text, '-', '');
begin
  if uid is null or (select role from public.profiles where id = uid) is distinct from 'employer' then
    raise exception 'Только для работодателей' using errcode = '42501';
  end if;
  if d !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' or length(d) > 253 then
    raise exception 'company_domain: неверный домен' using errcode = '22023';
  end if;
  if public.is_public_domain(d) then
    raise exception 'company_domain: нужен домен компании, а не почтовый сервис' using errcode = '22023';
  end if;
  perform set_config('fastcv.company_verify', 'on', true);
  update public.profiles
     set company_domain = d, company_verify_token = code, company_verified_at = null, company_checked_at = null
   where id = uid;
  update public.vacancies set employer_verified = false where employer_id = uid and employer_verified;
  return code;
end;
$$;

-- Шаг 2: проверка TXT-записи. Не чаще раза в 10 секунд на работодателя.
create or replace function public.check_company_verification()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  p record;
  answer jsonb;
  found_it boolean := false;
begin
  select company_domain, company_verify_token, company_checked_at, company_verified_at
    into p from public.profiles where id = uid and role = 'employer';
  if p.company_domain is null or p.company_verify_token is null then
    raise exception 'company_domain: сначала укажите домен' using errcode = '22023';
  end if;
  if p.company_verified_at is not null then
    return true;
  end if;
  if p.company_checked_at > now() - interval '10 seconds' then
    raise exception 'company_domain: подождите несколько секунд' using errcode = 'P0001';
  end if;
  perform set_config('fastcv.company_verify', 'on', true);
  update public.profiles set company_checked_at = now() where id = uid;

  perform set_config('http.timeout_msec', '5000', true);
  begin
    select content::jsonb into answer
      from extensions.http((
        'GET',
        'https://cloudflare-dns.com/dns-query?type=TXT&name=' || p.company_domain,
        array[extensions.http_header('accept', 'application/dns-json')],
        null, null)::extensions.http_request);
  exception when others then
    raise exception 'company_domain: DNS не ответил, попробуйте ещё раз' using errcode = 'P0001';
  end;
  select exists (
    select 1 from jsonb_array_elements(coalesce(answer -> 'Answer', '[]'::jsonb)) a
     where replace(a ->> 'data', '"', '') like '%fastcv-verify=' || p.company_verify_token || '%'
  ) into found_it;

  if found_it then
    update public.profiles set company_verified_at = now() where id = uid;
    update public.vacancies set employer_verified = true where employer_id = uid;
  end if;
  return found_it;
end;
$$;

revoke all on function public.start_company_verification(text) from public, anon;
revoke all on function public.check_company_verification() from public, anon;
grant execute on function public.start_company_verification(text) to authenticated;
grant execute on function public.check_company_verification() to authenticated;

-- Новая вакансия подтверждённого работодателя — сразу со значком
create or replace function public.set_employer_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.employer_verified := new.employer_id is not null and exists (
    select 1 from public.profiles where id = new.employer_id and company_verified_at is not null);
  return new;
end;
$$;

-- На любое изменение: работодатель не может вписать значок своей вакансии сам
create or replace trigger vacancies_set_employer_verified
  before insert or update on public.vacancies
  for each row execute function public.set_employer_verified();
-- Функцию-триггер через API не вызывают
revoke execute on function public.set_employer_verified() from public, anon, authenticated;
