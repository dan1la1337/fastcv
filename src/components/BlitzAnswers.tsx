"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

export type BlitzAnswer = { q: string; a: string };

/** Ответы кандидата на микро-блиц и ИИ-выжимка для работодателя (план 1.15). */
export default function BlitzAnswers({ applicationId, answers, summary }: {
  applicationId: string;
  answers: BlitzAnswer[];
  summary: string | null;
}) {
  const [text, setText] = useState(summary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!answers.length) return null;

  async function summarize() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/blitz-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId }),
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (res.ok && data.text) setText(data.text);
      else setError(data.error ?? "Не получилось. Попробуйте ещё раз.");
    } catch {
      setError("Нет связи с сервером. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 p-4 space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">Ответы на ваши вопросы</p>
        {!text && (
          <button type="button" onClick={summarize} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/15 text-xs text-neutral-200 hover:border-white/30 disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-teal-300" />} ИИ-выжимка
          </button>
        )}
      </div>
      {text && (
        <div className="rounded-xl bg-teal-300/[0.06] border border-teal-300/20 p-3 text-neutral-200 whitespace-pre-line leading-relaxed">
          <p className="text-xs text-teal-300 mb-1.5 inline-flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Выжимка ИИ</p>
          <p>{text}</p>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
      <dl className="space-y-2.5">
        {answers.map((x, i) => (
          <div key={i}>
            <dt className="text-neutral-400">{x.q}</dt>
            <dd className="text-neutral-200 whitespace-pre-line mt-0.5">{x.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
