"use client";

import { useEffect, useState } from "react";
import { BellRing, Loader2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/Toaster";

/**
 * Подписка на подборку в Telegram (профиль кандидата).
 * «Подключить» выдаёт одноразовую ссылку на бота подборок; «Start» в боте сразу
 * привязывает чат (webhook /api/telegram/webhook). Подборки — вакансии с совпадением
 * от 70% — рассылает сборщик после каждого обновления.
 */
export default function TelegramSubscription({ userId }: { userId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [linked, setLinked] = useState(false);
  const [notify, setNotify] = useState(false);
  const [bot, setBot] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("profiles").select("telegram_chat_id, telegram_notify").eq("id", userId).maybeSingle(),
      supabase.from("app_settings").select("value").eq("key", "telegram_bot_username").maybeSingle(),
    ]).then(([{ data: profile }, { data: setting }]) => {
      setLinked(Boolean(profile?.telegram_chat_id));
      setNotify(Boolean(profile?.telegram_notify));
      setBot(setting?.value ?? null);
      setLoaded(true);
    });
  }, [userId]);

  // Пока открыта ссылка на бота, раз в 3 секунды проверяем, привязался ли чат (до 3 минут)
  useEffect(() => {
    if (!link || linked) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const { data } = await supabase.from("profiles").select("telegram_chat_id, telegram_notify").eq("id", userId).maybeSingle();
      if (data?.telegram_chat_id) {
        setLinked(true);
        setNotify(Boolean(data.telegram_notify));
        toast("Telegram подключён — подборка включена.", "ok");
        clearInterval(timer);
      } else if (tries >= 60) {
        clearInterval(timer);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [link, linked, userId]);

  async function connect() {
    setBusy(true);
    const { data: code, error } = await supabase.rpc("create_telegram_link_code");
    setBusy(false);
    if (error || !code) {
      toast("Не удалось получить ссылку: " + (error?.message ?? "нет кода"), "error");
      return;
    }
    setLink(`https://t.me/${bot}?start=${code}`);
  }

  async function toggle() {
    const next = !notify;
    setNotify(next);
    const { error } = await supabase.from("profiles").update({ telegram_notify: next }).eq("id", userId);
    if (error) {
      setNotify(!next);
      toast("Не удалось сохранить: " + error.message, "error");
    }
  }

  async function unlink() {
    setBusy(true);
    const { error } = await supabase.rpc("unlink_telegram");
    setBusy(false);
    if (error) return toast("Не удалось отключить: " + error.message, "error");
    setLinked(false);
    setNotify(false);
    setLink(null);
  }

  if (!loaded) return null;

  return (
    <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-6 sm:p-8 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><BellRing className="w-5 h-5 text-blue-400" /> Подборка в Telegram</h2>
        <p className="text-sm text-neutral-400 mt-1">
          Новые вакансии с совпадением от 70% — сообщением в Telegram, не чаще раза в несколько часов.
        </p>
      </div>

      {linked ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={notify} onChange={toggle} className="w-5 h-5 rounded bg-neutral-950 border-neutral-800 text-blue-600 focus:ring-0" />
            <span className="text-sm text-neutral-200">Присылать подборку</span>
          </label>
          <button onClick={unlink} disabled={busy} className="ml-auto text-xs text-neutral-400 hover:text-red-300">Отвязать Telegram</button>
        </div>
      ) : !bot ? (
        <p className="text-sm text-neutral-500">Бот ещё настраивается — загляните сюда чуть позже.</p>
      ) : link ? (
        <div className="space-y-2">
          <a href={link} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
            <Send className="w-4 h-4" /> Открыть @{bot} и нажать «Start»
          </a>
          <p className="text-xs text-neutral-500">
            Бот сразу пришлёт подтверждение, а здесь появится переключатель подборки.
          </p>
        </div>
      ) : (
        <button onClick={connect} disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-blue-500/40 text-blue-300 hover:bg-blue-600/10 text-sm font-medium disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Подключить Telegram
        </button>
      )}
    </div>
  );
}
