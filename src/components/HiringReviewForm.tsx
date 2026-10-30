"use client";

import { useState } from "react";
import { Loader2, MessageSquareQuote } from "lucide-react";
import { supabase } from "@/lib/supabase";
import InterviewStars from "@/components/InterviewStars";
import { toast } from "@/components/Toaster";

export type MyReview = { application_id: string; rating: number; pros: string | null; cons: string | null; reply: string | null };

const field = "w-full bg-[#0B0F19] border border-white/12 rounded-2xl px-4 py-2.5 text-sm text-neutral-100 focus:outline-none focus:border-teal-300 resize-y";

/** Отзыв кандидата о процессе найма (рейтинг работодателя). Публикуется анонимно. */
export default function HiringReviewForm({ applicationId, company, review, onSaved }: {
  applicationId: string;
  company: string | null;
  review: MyReview | null;
  onSaved: (r: MyReview) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(review?.rating ?? null);
  const [pros, setPros] = useState(review?.pros ?? "");
  const [cons, setCons] = useState(review?.cons ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!rating) return;
    setBusy(true);
    const { error } = await supabase.rpc("save_hiring_review", { application: applicationId, rating, pros: pros || null, cons: cons || null });
    setBusy(false);
    if (error) {
      const m = error.message.match(/review: (.+)/);
      return toast(m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + "." : "Не удалось сохранить отзыв. Попробуйте ещё раз.", "error");
    }
    onSaved({ application_id: applicationId, rating, pros: pros.trim() || null, cons: cons.trim() || null, reply: review?.reply ?? null });
    setOpen(false);
    toast("Спасибо! Отзыв опубликован анонимно на странице компании.", "ok");
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 px-4 py-3">
        <p className="text-sm text-neutral-300">
          {review ? <>Ваш отзыв о найме: <span className="text-amber-300">{"★".repeat(review.rating)}</span></> : "Как вам процесс найма?"}
          <span className="block text-xs text-neutral-500">Анонимно, на странице {company ? `компании «${company}»` : "компании"}</span>
        </p>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/15 text-xs text-neutral-200 hover:border-white/30">
          <MessageSquareQuote className="w-3.5 h-3.5" /> {review ? "Изменить отзыв" : "Оставить отзыв"}
        </button>
        {review?.reply && (
          <p className="w-full text-xs text-indigo-200 border-l-2 border-indigo-400/40 pl-3">Ответ компании: <span className="text-neutral-300">{review.reply}</span></p>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-teal-300/25 bg-teal-300/[0.04] p-4 space-y-3">
      <p className="text-sm text-neutral-200">Оцените процесс найма: скорость ответа, понятность этапов, отношение к кандидату</p>
      <InterviewStars value={rating} onRate={setRating} disabled={busy} label="Оценка процесса найма" />
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-xs text-neutral-400 space-y-1.5 block">
          <span>Что понравилось</span>
          <textarea rows={3} maxLength={1000} value={pros} onChange={e => setPros(e.target.value)} placeholder="Быстро ответили, понятное тестовое…" className={field} />
        </label>
        <label className="text-xs text-neutral-400 space-y-1.5 block">
          <span>Что не понравилось</span>
          <textarea rows={3} maxLength={1000} value={cons} onChange={e => setCons(e.target.value)} placeholder="Долго молчали после собеседования…" className={field} />
        </label>
      </div>
      <p className="text-[11px] text-neutral-500">Отзыв публикуется без имени — видны только ваш уровень и вакансия. Пишите о процессе найма, без личных данных.</p>
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="px-3 h-10 text-sm text-neutral-400 hover:text-white">Отмена</button>
        <button onClick={save} disabled={busy || !rating}
          className="px-5 h-10 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Опубликовать
        </button>
      </div>
    </div>
  );
}
