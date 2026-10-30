"use client";

import { useState } from "react";
import { CalendarCheck, CalendarClock, CalendarPlus, CalendarX, Loader2, Plus, Video, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  DURATIONS, MAX_SLOTS, downloadIcs, googleCalendarUrl, isLink, slotLabel, slotRange, slotsErrorText, toLocalInput, zoneLabel,
  type CalendarEvent, type Slot,
} from "@/lib/interviews";
import type { Conversation, Message } from "@/lib/chat";

const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

function eventFor(slot: Pick<Slot, "id" | "starts_at" | "duration_min" | "place">, c: Conversation): CalendarEvent {
  return {
    id: slot.id,
    title: `Собеседование: ${c.vacancy_title} — ${c.other_name}`,
    startsAt: slot.starts_at,
    minutes: slot.duration_min,
    place: slot.place,
    details: `Чат на FastCV: https://fastcv.ru/messages?c=${c.id}`,
  };
}

function Place({ place }: { place: string | null | undefined }) {
  if (!place) return null;
  return isLink(place) ? (
    <a href={place.trim()} target="_blank" rel="noopener noreferrer nofollow"
      className="inline-flex items-center gap-1.5 text-sm text-teal-300 hover:text-teal-200 break-all">
      <Video className="w-4 h-4 shrink-0" aria-hidden="true" /> {place}
    </a>
  ) : <p className="text-sm text-neutral-300 break-words">Где: {place}</p>;
}

/** Добавить в календарь: файл .ics (любой календарь) и Google Календарь. */
export function CalendarButtons({ event }: { event: CalendarEvent }) {
  return (
    <span className="inline-flex flex-wrap gap-2">
      <button type="button" onClick={() => downloadIcs(event)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/15 text-xs text-neutral-200 hover:border-white/30">
        <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" /> В календарь (.ics)
      </button>
      <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/15 text-xs text-neutral-200 hover:border-white/30">
        Google Календарь
      </a>
    </span>
  );
}

/** Сообщение с вариантами времени: кандидат выбирает, работодатель видит состояние. */
export function SlotsMessage({ message, slots, mine, isCandidate, onBooked }: {
  message: Message;
  slots: Record<string, Slot>;
  mine: boolean;
  isCandidate: boolean;
  onBooked: (m: Message) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids: string[] = (message.meta as { slot_ids?: string[] } | null)?.slot_ids ?? [];
  const list = ids.map(i => slots[i]).filter(Boolean);
  const meta = message.meta as { duration?: number; place?: string | null } | null;
  const booked = list.find(s => s.status === "booked");

  async function book(id: string) {
    setBusy(id);
    setError(null);
    const { data, error } = await supabase.rpc("book_interview_slot", { slot: id });
    setBusy(null);
    if (error) return setError(slotsErrorText(error.message));
    onBooked(data as unknown as Message);
  }

  return (
    <div className={`max-w-[92%] sm:max-w-[80%] ${mine ? "ml-auto" : ""} rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.05] p-4 space-y-3`}>
      <p className="text-xs text-emerald-300 inline-flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
        {mine ? "Вы предложили время собеседования" : "Выберите время собеседования"}
        <span className="text-neutral-500">· {time(message.created_at)}</span>
      </p>
      <p className="text-xs text-neutral-400">
        {meta?.duration ? `${meta.duration} мин` : ""}{meta?.duration ? " · " : ""}время — ваше местное ({zoneLabel()})
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-neutral-400">{message.body}</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-2" aria-label="Варианты времени">
          {list.map(s => {
            const active = s.status === "open";
            const label = `${slotLabel(s.starts_at)} – ${slotRange(s.starts_at, s.duration_min).split("–")[1]}`;
            return (
              <li key={s.id}>
                {isCandidate && active ? (
                  <button type="button" onClick={() => book(s.id)} disabled={!!busy}
                    className="w-full text-left px-3 py-2 rounded-xl border border-emerald-400/30 hover:border-emerald-300 hover:bg-emerald-400/10 text-sm text-white disabled:opacity-50 inline-flex items-center justify-between gap-2">
                    {label}
                    {busy === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="text-xs text-emerald-300">Выбрать</span>}
                  </button>
                ) : (
                  <div className={`px-3 py-2 rounded-xl border text-sm flex items-center justify-between gap-2 ${
                    s.status === "booked" ? "border-emerald-300/60 bg-emerald-400/10 text-white" : "border-white/10 text-neutral-500"}`}>
                    <span className={s.status === "withdrawn" || s.status === "cancelled" ? "line-through" : ""}>{label}</span>
                    <span className="text-xs">{s.status === "booked" ? "выбрано" : s.status === "open" ? "свободно" : ""}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Place place={meta?.place} />
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
      {!booked && !isCandidate && list.some(s => s.status === "open") && (
        <p className="text-xs text-neutral-500">Кандидат выберет удобное время — вам придёт сообщение.</p>
      )}
    </div>
  );
}

/** Сообщение о записи или отмене. */
export function BookingMessage({ message, mine }: { message: Message; mine: boolean }) {
  const meta = message.meta as { action?: string; starts_at?: string; duration?: number; reason?: string | null } | null;
  const cancelled = meta?.action === "cancelled";
  return (
    <div className="mx-auto max-w-[92%] sm:max-w-[80%] rounded-2xl border border-white/12 bg-white/[0.04] p-4 space-y-1.5">
      <p className={`text-xs inline-flex items-center gap-1.5 ${cancelled ? "text-amber-300" : "text-emerald-300"}`}>
        {cancelled ? <CalendarX className="w-3.5 h-3.5" /> : <CalendarCheck className="w-3.5 h-3.5" />}
        {cancelled ? (mine ? "Вы отменили собеседование" : "Собеседование отменено") : (mine ? "Вы записались на собеседование" : "Кандидат записался на собеседование")}
        <span className="text-neutral-500">· {time(message.created_at)}</span>
      </p>
      {meta?.starts_at && (
        <p className={`text-sm font-semibold ${cancelled ? "text-neutral-400 line-through" : "text-white"}`}>
          {slotLabel(meta.starts_at)}{meta.duration ? `, ${meta.duration} мин` : ""}
        </p>
      )}
      {cancelled && meta?.reason && <p className="text-sm text-neutral-300">Причина: {meta.reason}</p>}
    </div>
  );
}

/** Плашка над перепиской: ближайшее назначенное собеседование, календарь, отмена. */
export function UpcomingInterview({ slot, conversation, onCancelled }: {
  slot: Slot;
  conversation: Conversation;
  onCancelled: (m: Message) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("cancel_interview_slot", { slot: slot.id, reason: reason || null });
    setBusy(false);
    if (error) return setError(slotsErrorText(error.message));
    setAsking(false);
    onCancelled(data as unknown as Message);
  }

  return (
    <div className="mx-3 sm:mx-5 mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.07] px-4 py-3 space-y-2" aria-label="Назначенное собеседование">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-white inline-flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-emerald-300" aria-hidden="true" />
          Собеседование: <b>{slotLabel(slot.starts_at)}</b>
          <span className="text-neutral-400">({slotRange(slot.starts_at, slot.duration_min)})</span>
        </p>
        <span className="inline-flex flex-wrap gap-2">
          <CalendarButtons event={eventFor(slot, conversation)} />
          {!asking && (
            <button type="button" onClick={() => setAsking(true)} className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white">Отменить</button>
          )}
        </span>
      </div>
      <Place place={slot.place} />
      {asking && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`cancel-${slot.id}`}>Причина отмены</label>
          <input id={`cancel-${slot.id}`} value={reason} maxLength={500} onChange={e => setReason(e.target.value)}
            placeholder="Причина (по желанию)"
            className="flex-1 min-w-[12rem] bg-[#0B0F19] border border-white/12 rounded-full px-4 h-9 text-sm text-neutral-100 focus:outline-none focus:border-teal-300" />
          <button type="button" onClick={cancel} disabled={busy}
            className="px-4 h-9 rounded-full bg-amber-300 text-neutral-950 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Отменить встречу
          </button>
          <button type="button" onClick={() => setAsking(false)} className="px-2 h-9 text-sm text-neutral-400 hover:text-white">Не отменять</button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
    </div>
  );
}

function defaultTimes(): string[] {
  // Завтра и послезавтра в 11:00 и 15:00 — частые варианты, работодатель поправит
  const out: string[] = [];
  for (const days of [1, 2]) {
    for (const h of [11, 15]) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(h, 0, 0, 0);
      out.push(toLocalInput(d));
    }
  }
  return out.slice(0, 3);
}

/** Форма работодателя: варианты времени, длительность, ссылка или адрес. */
export function ProposeSlots({ conversationId, onSent, onClose }: {
  conversationId: string;
  onSent: (m: Message) => void;
  onClose: () => void;
}) {
  const [times, setTimes] = useState<string[]>(defaultTimes);
  const [duration, setDuration] = useState(60);
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "bg-[#0B0F19] border border-white/12 rounded-xl px-3 h-10 text-sm text-neutral-100 focus:outline-none focus:border-teal-300";

  async function send() {
    const starts = times.filter(Boolean).map(t => new Date(t).toISOString());
    if (!starts.length) return setError("Добавьте хотя бы один вариант времени.");
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("propose_interview_slots", {
      conversation: conversationId, starts, duration, place: place.trim() || null,
    });
    setBusy(false);
    if (error) return setError(slotsErrorText(error.message));
    onSent(data as unknown as Message);
  }

  return (
    <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.04] p-3 space-y-3" role="group" aria-label="Предложить время собеседования">
      <div className="flex items-center justify-between">
        <p className="text-sm text-white font-semibold">Варианты времени <span className="text-xs text-neutral-500 font-normal">({zoneLabel()})</span></p>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.08]">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {times.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <label htmlFor={`slot-${conversationId}-${i}`} className="sr-only">Вариант {i + 1}</label>
            <input id={`slot-${conversationId}-${i}`} type="datetime-local" value={t} step={900}
              onChange={e => setTimes(all => all.map((x, j) => j === i ? e.target.value : x))} className={`${field} flex-1 min-w-0`} />
            {times.length > 1 && (
              <button type="button" onClick={() => setTimes(all => all.filter((_, j) => j !== i))} aria-label={`Убрать вариант ${i + 1}`}
                className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/[0.08]"><X className="w-4 h-4" /></button>
            )}
          </div>
        ))}
        {times.length < MAX_SLOTS && (
          <button type="button" onClick={() => setTimes(all => [...all, ""])}
            className="h-10 rounded-xl border border-dashed border-white/15 text-sm text-neutral-400 hover:text-white hover:border-white/30 inline-flex items-center justify-center gap-1.5">
            <Plus className="w-4 h-4" /> Ещё вариант
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-neutral-400 inline-flex items-center gap-2">
          Длительность
          <select value={duration} onChange={e => setDuration(Number(e.target.value))} className={field}>
            {DURATIONS.map(d => <option key={d} value={d}>{d} мин</option>)}
          </select>
        </label>
        <label className="flex-1 min-w-[14rem] text-xs text-neutral-400 inline-flex items-center gap-2">
          <span className="whitespace-nowrap">Ссылка или адрес</span>
          <input value={place} maxLength={300} onChange={e => setPlace(e.target.value)}
            placeholder="https://telemost.yandex.ru/… или офис" className={`${field} flex-1 min-w-0`} />
        </label>
      </div>
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={send} disabled={busy}
          className="px-5 h-10 rounded-full bg-emerald-300 hover:bg-emerald-200 text-neutral-950 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Отправить варианты
        </button>
      </div>
    </div>
  );
}
