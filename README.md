# FastCV

AI-биржа вакансий. Вакансии собираются из Telegram-каналов и нормализуются нейросетью. Кандидат откликается в один клик с сопроводительным письмом, которое пишет ИИ под конкретную вакансию. Работодатели публикуют вакансии напрямую и разбирают отклики в своём кабинете.

## Как устроено

| Часть | Где | Что делает |
|---|---|---|
| Сайт | `src/` | Next.js 16 + Tailwind. Лента с фильтрами, Smart Apply, кабинеты кандидата и работодателя |
| API писем | `src/app/api/cover-letter` | Генерирует сопроводительное через Gemini. Только для вошедших, с лимитом запросов |
| Сборщик | `main.py` | Раз в 6 часов (GitHub Actions) парсит каналы из таблицы `channels`, прогоняет посты через Gemini и сохраняет вакансии |
| База | `supabase/schema.sql` | Таблицы, триггеры и правила доступа (RLS) для Supabase |

**Роли.** Роль (`candidate` или `employer`) выбирается при регистрации и потом не меняется: это гарантирует триггер в базе. Работодатель попадает в `/employer`, кандидат — на главную и в `/applications`.

## Запуск локально

1. Установите Node.js 20+ и Python 3.11+.
2. Скопируйте `.env.example` в `.env.local` и заполните ключи.
3. Примените схему базы: Supabase → SQL Editor → вставьте `supabase/schema.sql` → Run. Скрипт безопасно запускать повторно.
4. Запустите сайт:
   ```bash
   npm install
   npm run dev
   ```
   Сайт откроется на http://localhost:3000.
5. Сборщик (по желанию):
   ```bash
   pip install -r requirements.txt
   python main.py
   ```
   Каналы для парсинга добавляются в таблицу `channels` (`username`, `is_active = true`).

## Деплой

- **Сайт (Vercel):** задайте `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` и `GEMINI_API_KEY` в Environment Variables. В `NEXT_PUBLIC_SUPABASE_ANON_KEY` — только **публичный** ключ (`sb_publishable_…` или `anon`): всё с префиксом `NEXT_PUBLIC_` попадает в браузер. С секретным ключом сборка остановится. Переменные `NEXT_PUBLIC_*` вшиваются при сборке, поэтому после их изменения нужен редеплой.
- **Сборщик (GitHub Actions):** секреты `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` и `GEMINI_API_KEY`.
- **Supabase → Authentication → URL Configuration:** добавьте `https://<ваш-домен>/auth/callback` в Redirect URLs, чтобы работала ссылка подтверждения почты.
