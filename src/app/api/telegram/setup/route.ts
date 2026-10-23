import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { jobsBotToken, telegram, TelegramApiError, webhookSecret } from "@/lib/telegram";

// Кнопка «Подключить бота подборок» в /admin: узнаёт имя бота, направляет его сообщения
// на /api/telegram/webhook этого сайта и сохраняет имя для ссылки в профилях кандидатов.

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: isAdmin } = await supabase.rpc("is_app_admin");
  if (!isAdmin) return NextResponse.json({ error: "Только для администратора" }, { status: 403 });

  const token = jobsBotToken();
  if (!token) {
    return NextResponse.json(
      { error: "На сервере не задан TELEGRAM_JOBS_BOT_TOKEN (Vercel → Settings → Environment Variables), после добавления нужен новый деплой" },
      { status: 503 },
    );
  }

  try {
    const me = await telegram<{ username?: string }>(token, "getMe");
    if (!me.username) throw new TelegramApiError(0, "бот без имени");
    const url = `${request.nextUrl.origin}/api/telegram/webhook`;
    await telegram(token, "setWebhook", {
      url,
      secret_token: webhookSecret(token),
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
    const { error } = await supabase.rpc("set_telegram_bot", { username: me.username });
    if (error) return NextResponse.json({ error: `Имя бота не сохранено: ${error.message}` }, { status: 500 });
    return NextResponse.json({ username: me.username, url });
  } catch (error) {
    const message = error instanceof TelegramApiError ? `Telegram ответил: ${error.message}` : "Telegram недоступен";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
