"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

/** /admin: подключение бота подборок (webhook + имя бота для профилей кандидатов). */
export default function TelegramBotSetup({ current }: { current: string | null }) {
  const [bot, setBot] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function setup() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/telegram/setup", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { username?: string; error?: string };
      if (response.ok && body.username) {
        setBot(body.username);
        setMessage({ ok: true, text: `Готово: @${body.username} отвечает кандидатам сразу.` });
      } else {
        setMessage({ ok: false, text: body.error ?? "Не получилось" });
      }
    } catch {
      setMessage({ ok: false, text: "Сайт не ответил. Попробуйте ещё раз." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-neutral-300">Бот подборок для кандидатов</h2>
      <p className="text-sm text-neutral-400">
        {bot ? <>Сейчас в профилях ссылка на <a className="text-blue-400 hover:underline" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">@{bot}</a>.</> : "Бот ещё не подключён — кандидаты видят «Бот настраивается»."}
        {" "}Кнопка берёт токен из TELEGRAM_JOBS_BOT_TOKEN на Vercel; её можно нажимать повторно.
      </p>
      <button onClick={setup} disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Подключить бота подборок
      </button>
      {message && <p className={`text-sm ${message.ok ? "text-emerald-400" : "text-red-300"}`}>{message.text}</p>}
    </section>
  );
}
