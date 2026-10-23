import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { jobsBotToken, telegram, webhookSecret } from "@/lib/telegram";

// Сообщения боту подборок. Telegram присылает их сюда сразу (webhook, настраивается
// кнопкой в /admin), поэтому «Start» по ссылке из профиля привязывает чат мгновенно.

const START = /^\/start(?:@\w+)?(?:\s+([0-9a-f]{32}))?\s*$/;
const SITE = "https://fastcv.ru";

type Update = { message?: { text?: string; chat?: { id?: number; type?: string } } };

function sameSecret(got: string | null, expected: string): boolean {
  if (!got || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  const token = jobsBotToken();
  if (!token) return NextResponse.json({ ok: false }, { status: 503 });
  // Запрос не от Telegram — молча отказываем
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), webhookSecret(token))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json().catch(() => ({}))) as Update;
  const chat = update.message?.chat;
  const text = (update.message?.text ?? "").trim();
  if (!chat?.id || chat.type !== "private") return NextResponse.json({ ok: true });

  let reply: string;
  const start = START.exec(text);
  if (start?.[1]) {
    const { data: linked } = await supabase.rpc("link_telegram_chat", { code: start[1], chat: chat.id });
    reply = linked
      ? "✅ Готово! Сюда будут приходить новые вакансии, которые подходят вам на 70% и больше.\n\n" +
        `Настроить, что ищете, или отключить подборку можно в профиле: ${SITE}/profile`
      : "Эта ссылка уже использована или устарела. Откройте профиль на fastcv.ru и нажмите «Подключить Telegram» ещё раз: " +
        `${SITE}/profile`;
  } else {
    reply = "Это бот подборок FastCV: присылает новые вакансии под ваш профиль.\n\n" +
      `Чтобы подключить его, войдите на сайт и нажмите «Подключить Telegram» в профиле: ${SITE}/profile`;
  }

  try {
    await telegram(token, "sendMessage", { chat_id: chat.id, text: reply, disable_web_page_preview: true });
  } catch (error) {
    console.error("Telegram reply failed", error instanceof Error ? error.message : error);
  }
  // Telegram повторяет запрос, пока не получит 200 — отвечаем 200 даже при сбое ответа
  return NextResponse.json({ ok: true });
}
