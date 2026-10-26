-- Аудит 26.10 (советник Supabase): функцию-триггер лимита откликов нельзя вызывать через API.
-- Триггер работает и без права EXECUTE у пользователя — его проверяют только при создании триггера.
revoke execute on function public.limit_daily_applications() from public, anon, authenticated;
