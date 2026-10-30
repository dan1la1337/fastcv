"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase, Check, CheckCheck, CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { chatErrorText, dayLabel, MESSAGE_COLUMNS, MESSAGE_MAX, splitLinks, type Conversation, type Message } from "@/lib/chat";

const POLL_MS = 4_000;
const HISTORY = 200;

function Linked({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) => part.href
        ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-teal-300/50 hover:decoration-teal-300 break-all">{part.text}</a>
        : <Fragment key={i}>{part.text}</Fragment>)}
    </>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Переписка в одном диалоге: сообщения, отправка, отметка «прочитано». */
export default function ChatThread({ conversation, userId, onBack, onChanged }: {
  conversation: Conversation;
  userId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);         // пользователь внизу ленты — новые сообщения прокручиваем
  const lastId = useRef(0);
  const id = conversation.id;

  const markRead = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    await supabase.rpc("mark_conversation_read", { conversation: id });
    window.dispatchEvent(new Event("chat:read"));
    onChanged();
  }, [id, onChanged]);

  const append = useCallback((fresh: Message[]) => {
    if (!fresh.length) return;
    lastId.current = Math.max(lastId.current, ...fresh.map(m => m.id));
    setMessages(prev => {
      const known = new Set((prev ?? []).map(m => m.id));
      return [...(prev ?? []), ...fresh.filter(m => !known.has(m.id))].sort((a, b) => a.id - b.id);
    });
  }, []);

  // Первая загрузка: последние HISTORY сообщений
  useEffect(() => {
    let alive = true;
    supabase.from("messages").select(MESSAGE_COLUMNS).eq("conversation_id", id)
      .order("id", { ascending: false }).limit(HISTORY)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) return setLoadError(true);
        const list = ((data ?? []) as Message[]).reverse();
        lastId.current = list.at(-1)?.id ?? 0;
        setMessages(list);
        markRead();
      });
    return () => { alive = false; };
  }, [id, markRead]);

  // Новые сообщения: опрос раз в несколько секунд, пока вкладка на экране
  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== "visible" || messages === null) return;
      const { data } = await supabase.from("messages").select(MESSAGE_COLUMNS)
        .eq("conversation_id", id).gt("id", lastId.current).order("id");
      const fresh = (data ?? []) as Message[];
      if (fresh.length) {
        append(fresh);
        if (fresh.some(m => m.sender_id !== userId)) markRead();
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [id, userId, messages, append, markRead]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const { data, error } = await supabase.rpc("send_message", { conversation: id, body });
    setSending(false);
    if (error) return setError(chatErrorText(error.message));
    setText("");
    stick.current = true;
    append([data as unknown as Message]);
    onChanged();
    input.current?.focus();
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter отправляет на компьютере; на телефоне Enter — перенос строки, отправка — кнопкой
    const touch = window.matchMedia?.("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const otherRead = conversation.other_read_at ? Date.parse(conversation.other_read_at) : 0;
  const lastMine = messages?.filter(m => m.sender_id === userId).at(-1);

  return (
    <>
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <button onClick={onBack} aria-label="К списку диалогов" className="md:hidden p-1.5 -ml-1.5 rounded-lg hover:bg-white/[0.08]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <p className="font-semibold text-white truncate">{conversation.other_name}</p>
          {conversation.vacancy_id ? (
            <Link href={`/vacancy/${conversation.vacancy_id}`} className="text-xs text-neutral-400 hover:text-teal-300 truncate block">
              {conversation.vacancy_title}
            </Link>
          ) : <p className="text-xs text-neutral-500 truncate">{conversation.vacancy_title}</p>}
        </div>
      </header>

      <div ref={scroller} role="log" aria-live="polite" aria-label={`Переписка с ${conversation.other_name}`}
        onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-4 space-y-2">
        {loadError ? (
          <p className="text-center text-sm text-amber-300 py-10">Не удалось загрузить переписку. Обновите страницу.</p>
        ) : messages === null ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-teal-300" /></div>
        ) : messages.map((m, i) => {
          const mine = m.sender_id === userId;
          const newDay = i === 0 || dayLabel(messages[i - 1].created_at) !== dayLabel(m.created_at);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <p className="text-center text-[11px] text-neutral-500 py-2">{dayLabel(m.created_at)}</p>
              )}
              {m.kind === "application" ? (
                <div className={`max-w-[92%] sm:max-w-[80%] ${mine ? "ml-auto" : ""} rounded-2xl border border-teal-300/25 bg-teal-300/[0.06] p-4 space-y-3`}>
                  <p className="text-xs text-teal-300">
                    {mine ? "Ваш отклик" : "Отклик"} на вакансию «{m.meta?.vacancy_title ?? conversation.vacancy_title}» · {time(m.created_at)}
                  </p>
                  <p className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed"><Linked text={m.body} /></p>
                  {!!m.meta?.blitz?.length && (
                    <dl className="space-y-2 border-t border-white/10 pt-3 text-sm">
                      {m.meta.blitz.map((x, j) => (
                        <div key={j}><dt className="text-neutral-400">{x.q}</dt><dd className="text-neutral-200 whitespace-pre-wrap">{x.a}</dd></div>
                      ))}
                    </dl>
                  )}
                </div>
              ) : m.kind === "offer" ? (
                <div className={`max-w-[92%] sm:max-w-[80%] ${mine ? "ml-auto" : ""} rounded-2xl border border-indigo-400/30 bg-indigo-400/[0.07] p-4 space-y-2`}>
                  <p className="text-xs text-indigo-200 inline-flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
                    {mine ? "Вы предложили вакансию" : "Работодатель предлагает вакансию"}
                    <span className="text-neutral-500">· {time(m.created_at)}</span>
                  </p>
                  {m.meta?.vacancy_id && (
                    <Link href={`/vacancy/${m.meta.vacancy_id}`} className="block font-semibold text-white hover:text-teal-300">
                      {m.meta.vacancy_title}
                    </Link>
                  )}
                  <p className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed"><Linked text={m.body} /></p>
                </div>
              ) : m.kind === "status" ? (
                <div className="mx-auto max-w-[92%] sm:max-w-[80%] rounded-2xl border border-white/12 bg-white/[0.04] p-4 space-y-2">
                  <p className={`text-xs inline-flex items-center gap-1.5 ${m.meta?.status === "interview_scheduled" ? "text-emerald-300" : "text-neutral-400"}`}>
                    {m.meta?.status === "interview_scheduled"
                      ? <><CheckCircle2 className="w-3.5 h-3.5" /> Приглашение на собеседование</>
                      : <><XCircle className="w-3.5 h-3.5" /> Отказ</>}
                    <span className="text-neutral-500">· {time(m.created_at)}</span>
                  </p>
                  <p className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed"><Linked text={m.body} /></p>
                </div>
              ) : (
                <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    mine ? "bg-teal-300 text-neutral-950 rounded-br-md" : "bg-white/[0.08] text-neutral-100 rounded-bl-md"}`}>
                    <p className="whitespace-pre-wrap break-words"><Linked text={m.body} /></p>
                    <p className={`mt-0.5 text-[10px] text-right flex items-center justify-end gap-1 ${mine ? "text-neutral-800" : "text-neutral-500"}`}>
                      {time(m.created_at)}
                      {mine && m.id === lastMine?.id && (Date.parse(m.created_at) <= otherRead
                        ? <CheckCheck className="w-3.5 h-3.5" aria-label="Прочитано" />
                        : <Check className="w-3.5 h-3.5" aria-label="Доставлено" />)}
                    </p>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      <form onSubmit={e => { e.preventDefault(); send(); }} className="border-t border-white/10 p-3 space-y-2">
        {error && <p role="alert" className="text-xs text-amber-300 px-1">{error}</p>}
        <div className="flex items-end gap-2">
          <label htmlFor={`chat-input-${id}`} className="sr-only">Сообщение</label>
          <textarea id={`chat-input-${id}`} ref={input} value={text} rows={1} maxLength={MESSAGE_MAX}
            onChange={e => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
            onKeyDown={onKey} placeholder="Сообщение…"
            className="flex-1 resize-none bg-[#0B0F19] border border-white/12 rounded-2xl px-4 py-2.5 text-sm text-neutral-100 focus:outline-none focus:border-teal-300 max-h-40" />
          <button type="submit" disabled={sending || !text.trim()} aria-label="Отправить"
            className="shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 disabled:opacity-40 transition-colors">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        {text.length > MESSAGE_MAX - 300 && (
          <p className="text-[11px] text-neutral-500 text-right px-1">{text.length} / {MESSAGE_MAX}</p>
        )}
      </form>
    </>
  );
}
