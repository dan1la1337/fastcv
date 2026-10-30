"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Star } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { stageLabel } from "@/lib/rating";
import { toast } from "@/components/Toaster";

type Review = {
  id: string; vacancy_title: string | null; stage: string; rating: number; pros: string | null
  cons: string | null; reply: string | null; created_at: string; hidden: boolean
};

/** Вкладка «Отзывы» кабинета работодателя: отзывы кандидатов о найме и публичные ответы на них. */
export default function EmployerReviews({ companyName, onCount }: { companyName: string | null; onCount?: (n: number) => void }) {
  const [reviews, setReviews] = useState<Review[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("employer_reviews").then(({ data }) => {
      if (cancelled) return;
      setReviews((data ?? []) as Review[]);
      onCount?.((data ?? []).length);
    });
    return () => { cancelled = true; };
  }, [onCount]);

  if (!reviews) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-neutral-500" /></div>;

  return (
    <div className="space-y-4">
      <div className="glass rounded-3xl p-5 text-sm text-neutral-300 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl">
          Кандидаты оценивают процесс найма анонимно: скорость ответа, этапы, отношение. Отзывы и ваш ответ видны всем на странице компании —
          вежливый ответ по существу работает лучше любой рекламы.
        </p>
        {companyName && (
          <Link href={`/company/${encodeURIComponent(companyName)}`} className="text-teal-300 hover:text-teal-200 whitespace-nowrap">
            Рейтинг компании →
          </Link>
        )}
      </div>
      {!reviews.length ? (
        <p className="text-center text-neutral-500 py-12">Отзывов пока нет. Они появятся, когда кандидаты пройдут ваш процесс найма.</p>
      ) : reviews.map(r => <ReviewItem key={r.id} review={r} onReply={reply => setReviews(all => all!.map(x => x.id === r.id ? { ...x, reply } : x))} />)}
    </div>
  );
}

function ReviewItem({ review, onReply }: { review: Review; onReply: (reply: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const reply = text.trim() || null;
    const { error } = await supabase.rpc("reply_hiring_review", { review: review.id, reply });
    setBusy(false);
    if (error) return toast("Не удалось сохранить ответ. Попробуйте ещё раз.", "error");
    onReply(reply);
    setEditing(false);
    toast(reply ? "Ответ опубликован на странице компании." : "Ответ удалён.", "ok");
  }

  return (
    <div className="glass rounded-3xl p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1 text-amber-300 font-semibold">
          <Star className="w-4 h-4 fill-amber-300" /> {review.rating}
        </span>
        <span className="text-neutral-300">{review.vacancy_title ?? "Вакансия"}</span>
        <span className="text-neutral-500 text-xs">{stageLabel(review.stage)} · {new Date(review.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</span>
        {review.hidden && <span className="text-xs text-red-300">скрыт модератором</span>}
      </div>
      {review.pros && <p className="text-sm text-neutral-300"><span className="text-emerald-300">+ </span>{review.pros}</p>}
      {review.cons && <p className="text-sm text-neutral-300"><span className="text-red-300">− </span>{review.cons}</p>}
      {editing ? (
        <div className="space-y-2">
          <label className="block text-xs text-neutral-400 space-y-1.5">
            <span>Публичный ответ компании</span>
            <textarea rows={3} maxLength={1500} value={text} onChange={e => setText(e.target.value)}
              className="w-full bg-[#0B0F19] border border-white/12 rounded-2xl px-4 py-2.5 text-sm text-neutral-100 focus:outline-none focus:border-teal-300 resize-y" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="px-3 h-9 text-sm text-neutral-400 hover:text-white">Отмена</button>
            <button onClick={save} disabled={busy}
              className="px-4 h-9 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Опубликовать ответ
            </button>
          </div>
        </div>
      ) : review.reply ? (
        <div className="text-sm border-l-2 border-indigo-400/40 pl-3 space-y-1">
          <p className="text-xs text-indigo-200">Ваш ответ</p>
          <p className="text-neutral-300 whitespace-pre-line">{review.reply}</p>
          <button onClick={() => setEditing(true)} className="text-xs text-neutral-400 hover:text-white">Изменить</button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="text-sm text-teal-300 hover:text-teal-200">Ответить публично</button>
      )}
    </div>
  );
}
