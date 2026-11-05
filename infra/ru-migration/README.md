# Перенос базы FastCV в Россию

Зачем: по ч. 5 ст. 18 152-ФЗ персональные данные россиян при сборе должны впервые
записываться и храниться в базе на территории РФ. Сейчас база FastCV — облачный Supabase во
Франкфурте (`wyanvkaoqxgceaxzlqvk`, eu-central-1). Штраф за первое нарушение для юрлиц —
1–6 млн ₽, повторное — 6–18 млн ₽ (ч. 8–9 ст. 13.11 КоАП).

План: поднять **self-hosted Supabase** (официальный docker-compose) на российском сервере и
перенести туда базу. Код сайта и сборщика почти не меняется — это тот же Supabase, другой адрес
(`https://db.fastcv.ru`) и ключи.

## Что переносим (инвентаризация прода, 05.11.2026)

| Что | Объём | Как |
|---|---|---|
| База (Postgres 17) | 299 МБ, из них vacancies — 280 МБ (~77 тыс. строк) | схема — из `supabase/migrations`, данные — `pg_dump` |
| Пользователи | 152, вход только по email | `auth.users` + `auth.identities`, пароли (bcrypt) сохраняются |
| Файлы | бакет `resumes` (приватный, PDF до 5 МБ): 2 файла, 166 КБ | Storage API (`copy_storage.py`) |
| Фоновые задачи | 2 задачи pg_cron (витрины ленты, медленные работодатели) | создаются миграциями |
| Расширения | pg_cron, http, pg_trgm, pgcrypto, uuid-ossp | есть в образе supabase/postgres |
| Edge Functions, Realtime, Vault | не используются | — |

Схема из миграций репозитория совпадает с продом по количеству таблиц (26), функций (93),
политик RLS (37), триггеров (22) и витрин (4) — проверено. `03-migrate.sh verify` сверяет это ещё раз.

Сессии не переносятся: у нового сервера другой JWT-секрет, после переключения все **один раз
войдут заново** (пароль тот же).

## Что нужно от владельца

1. **Сервер в России**: Ubuntu 24.04, 2 vCPU / 4 ГБ RAM / 40 ГБ SSD (Timeweb Cloud, Selectel,
   Yandex Cloud — ~1000–1500 ₽/мес). Открыть порты 22, 80, 443.
2. **DNS**: A-запись `db.fastcv.ru` → IP сервера.
3. **Пароль базы старого проекта**: Supabase → Project Settings → Database (или кнопка Connect →
   Session pooler) — строка `postgresql://postgres.wyanvkaoqxgceaxzlqvk:<пароль>@…pooler.supabase.com:5432/postgres`.
4. **Ключ Resend** (`re_…`) — для писем подтверждения и сброса пароля с `noreply@fastcv.ru`.

## Шаги

Сначала — **репетиция на staging** (`fastcv-staging`, `zcyccnlweanhcsumplbx`): те же шаги с его
строкой подключения. Прод трогаем только после успешной репетиции.

### 1. Сервер (≈15 минут, сайт не затрагивается)

```sh
git clone https://github.com/dan1la1337/fastcv && cd fastcv
sudo RESEND_API_KEY=re_... sh infra/ru-migration/01-server-setup.sh
cd /opt/fastcv-supabase && sudo sh run.sh start
sudo sh run.sh secrets        # ANON_KEY / SERVICE_ROLE_KEY / пароль Studio — понадобятся ниже
```

Проверка: `https://db.fastcv.ru/auth/v1/health` отвечает. Studio (админка) — `https://db.fastcv.ru`,
логин/пароль из `run.sh secrets`.

### 2. Схема и пробный перенос данных (≈10 минут, сайт работает на старой базе)

```sh
cd ~/fastcv
export SRC_DB_URL='postgresql://postgres.wyanvkaoqxgceaxzlqvk:<пароль>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
sudo -E bash infra/ru-migration/03-migrate.sh check
sudo -E bash infra/ru-migration/03-migrate.sh schema
sudo -E bash infra/ru-migration/03-migrate.sh data
sudo -E bash infra/ru-migration/03-migrate.sh verify
```

`data` можно повторять сколько угодно: он каждый раз заменяет данные новой базы данными
источника целиком. Источник только читается.

### 3. Переключение (окно ≈15 минут)

1. Остановить сборщик: GitHub → Actions → Scraper → **Disable workflow**.
2. Финальная синхронизация: `03-migrate.sh data`, затем файлы и сверка:
   ```sh
   export SRC_SUPABASE_URL=https://wyanvkaoqxgceaxzlqvk.supabase.co SRC_SERVICE_KEY=<service_role старого>
   export DST_SUPABASE_URL=https://db.fastcv.ru DST_SERVICE_KEY=<SERVICE_ROLE_KEY нового>
   sudo -E bash infra/ru-migration/03-migrate.sh storage
   sudo -E bash infra/ru-migration/03-migrate.sh verify     # должно быть «✅ Строки совпадают»
   ```
3. **Vercel** → fastcv → Settings → Environment Variables (Production и Preview):
   `NEXT_PUBLIC_SUPABASE_URL=https://db.fastcv.ru`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY нового>` → Redeploy.
4. **GitHub** → Settings → Secrets → Actions: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — новые значения.
5. Проверка на fastcv.ru: вход существующим аккаунтом, лента, отклик, письмо, загрузка резюме,
   регистрация нового аккаунта (письмо подтверждения приходит, ссылка работает).
6. Включить сборщик обратно и запустить вручную (Run workflow) — новые вакансии пишутся в новую базу.
7. Резервные копии: `sudo sh infra/ru-migration/04-backup.sh install`.

Записи, сделанные в старой базе между финальной синхронизацией и редеплоем (минуты), не
переедут — поэтому окно короткое и сборщик на это время выключен.

### 4. После переключения

- Обновить политику конфиденциальности: Supabase → «серверы в России» (`src/app/privacy/page.tsx`).
- `package.json` → `db:types`: генерировать типы с новой базы (`supabase gen types --db-url …`).
- Через 2 недели стабильной работы — **удалить** старый облачный проект (Supabase → Settings →
  General → Delete project). До этого он — точка отката; после — копия ПДн за рубежом,
  которую держать дольше нет оснований.

## Откат

| Когда | Что делать | Потери |
|---|---|---|
| До шага 3 | Ничего: сайт всё время работал на старой базе. Новый сервер можно просто выключить | нет |
| Во время шага 3 | Вернуть в Vercel и GitHub старые `NEXT_PUBLIC_SUPABASE_URL` / ключи → Redeploy, включить сборщик | нет |
| После переключения | То же, плюс перенести новые записи обратно: `03-migrate.sh data` с `SRC_DB_URL=<новая база>` и `DST_DB_URL=<старая>` (`PG_LOCAL=1`, нужен клиент Postgres 17) — **отрепетировать на staging заранее** | записи между обратной синхронизацией и редеплоем |
| Сломались настройки сервера | `/opt/fastcv-supabase/.env.bak.*` → `.env`, `sh run.sh recreate` | нет |
| Сломались данные на новом сервере | восстановить из `/var/backups/fastcv/*.dump` (команда — в `04-backup.sh`) | после последней копии |

## Файлы

| Файл | Что делает |
|---|---|
| `01-server-setup.sh` | Docker + официальный self-hosted Supabase (`self-hosted/v0.8.4`), секреты, настройки FastCV |
| `02-configure.sh` | Повторяемо выставляет настройки FastCV в `.env` (адреса, только email-вход, SMTP Resend), копия `.env` до изменений |
| `overlay/` | `docker-compose.fastcv.yml` (русские письма авторизации), Caddyfile (HTTPS + раздача шаблонов писем), шаблоны писем |
| `03-migrate.sh` | `check` / `schema` / `data` / `storage` / `verify` |
| `copy_storage.py` | Копирование файлов резюме через Storage API |
| `04-backup.sh` | Ежедневные копии базы на сервере, 14 дней |
| `test-local.sh` | Проверка переноса на двух локальных базах; запускается в CI |

## Что остаётся за рубежом и как с этим быть

- **Vercel (хостинг сайта)** — запросы с данными проходят через серверы Vercel, но не хранятся
  там. Первичная запись теперь — в российской базе. Следующий шаг при желании — перенести и сайт
  на тот же сервер (`next start` в Docker), тогда за рубеж не уходит ничего, кроме обезличенного
  текста в Gemini.
- **Gemini** — получает обезличенные тексты (`src/lib/redact.ts`).
- **Resend, Telegram** — email-адрес и chat id для доставки сообщений. Это трансграничная
  передача: нужны уведомление РКН и согласие пользователя (см. документы в отчёте).
