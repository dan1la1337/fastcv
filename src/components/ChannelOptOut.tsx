"use client";

import { useState } from "react";
import { Ban, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export interface ExcludedChannel {
  username: string;
  excluded_at: string;
  excluded_note: string | null;
}

/** /admin: исключить канал по просьбе владельца — сбор выключается, его вакансии уходят в архив. */
export default function ChannelOptOut({ initial }: { initial: ExcludedChannel[] }) {
  const [list, setList] = useState(initial);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function exclude(e: React.FormEvent) {
    e.preventDefault();
    const username = name.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\/(s\/)?/, "").split(/[/?]/)[0];
    if (!username) return;
    if (!window.confirm(`Исключить @${username}? Сбор остановится, его вакансии уйдут из ленты.`)) return;
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("exclude_channel", { p_username: username, p_note: note.trim() || undefined });
    setBusy(false);
    if (error) {
      setMessage({ ok: false, text: error.message.includes("Неверное имя") ? "Неверное имя канала" : "Не получилось" });
      return;
    }
    setMessage({ ok: true, text: `@${username} исключён, из ленты убрано вакансий: ${data ?? 0}.` });
    setList(l => [{ username, excluded_at: new Date().toISOString(), excluded_note: note.trim() || null },
                  ...l.filter(c => c.username.toLowerCase() !== username.toLowerCase())]);
    setName("");
    setNote("");
  }

  return (
    <section className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-5 space-y-3">
      <h2 className="text-sm font-semibold text-neutral-300">Исключить канал по просьбе владельца</h2>
      <p className="text-sm text-neutral-400">
        Сбор из канала останавливается навсегда, его вакансии уходят в архив. Можно исключить и канал, которого ещё нет в
        списке, — тогда его не добавят позже.
      </p>
      <form onSubmit={exclude} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="optout-channel">Канал</label>
        <input id="optout-channel" value={name} onChange={e => setName(e.target.value)} placeholder="@channel или ссылка"
          className="flex-1 min-w-[12rem] rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm" />
        <label className="sr-only" htmlFor="optout-note">Основание</label>
        <input id="optout-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Основание: письмо от 26.10"
          className="flex-1 min-w-[12rem] rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm" />
        <button type="submit" disabled={busy || !name.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />} Исключить
        </button>
      </form>
      {message && <p className={`text-sm ${message.ok ? "text-emerald-400" : "text-red-300"}`}>{message.text}</p>}
      {list.length > 0 && (
        <ul className="text-xs text-neutral-400 space-y-1">
          {list.map(c => (
            <li key={c.username}>
              @{c.username} — {new Date(c.excluded_at).toLocaleDateString("ru-RU")}{c.excluded_note ? ` · ${c.excluded_note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
