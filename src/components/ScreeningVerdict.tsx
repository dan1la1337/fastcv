"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { FIT_LABEL, FIT_STYLE, type Screening } from "@/lib/screening";

export async function requestScreening(applicationId: string, refresh = false): Promise<{ screening?: Screening; error?: string }> {
  try {
    const res = await fetch("/api/screen-application", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId, refresh }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { screening: data.screening } : { error: data.error ?? "Не получилось. Попробуйте ещё раз." };
  } catch {
    return { error: "Нет связи с сервером. Попробуйте ещё раз." };
  }
}

/** ИИ-вердикт по отклику в кабинете работодателя: значок, плюсы, минусы, вопрос на собеседование. */
export default function ScreeningVerdict({ applicationId, screening, onChange }: {
  applicationId: string;
  screening: Screening | undefined;
  onChange: (s: Screening) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(refresh: boolean) {
    setBusy(true);
    setError(null);
    const { screening: s, error } = await requestScreening(applicationId, refresh);
    setBusy(false);
    if (error) return setError(error);
    if (s) onChange(s);
  }

  if (!screening) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => run(false)} disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-indigo-400/30 text-xs text-indigo-200 hover:border-indigo-300/60 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} ИИ-вердикт по отклику
        </button>
        {error && <span role="alert" className="text-xs text-amber-300">{error}</span>}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-indigo-400/20 bg-indigo-400/[0.04] p-4 space-y-2" aria-label="ИИ-вердикт">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2.5 py-0.5 rounded-full border text-xs font-medium ${FIT_STYLE[screening.fit]}`}>{FIT_LABEL[screening.fit]}</span>
        <p className="flex-1 min-w-[12rem] text-sm text-neutral-200">{screening.headline}</p>
        <button onClick={() => run(true)} disabled={busy} title="Разобрать заново (например, после обновления профиля кандидата)"
          aria-label="Разобрать отклик заново" className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/[0.08] disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {screening.pros.map((x, i) => <p key={`p${i}`} className="text-neutral-300"><span className="text-emerald-300">+ </span>{x}</p>)}
        {screening.cons.map((x, i) => <p key={`c${i}`} className="text-neutral-300"><span className="text-amber-300">− </span>{x}</p>)}
      </div>
      {screening.ask && <p className="text-sm text-neutral-300"><span className="text-indigo-200">Спросить на собеседовании: </span>{screening.ask}</p>}
      <p className="text-[11px] text-neutral-500">Подсказка ИИ по профилю и отклику, не решение. Кандидат её не видит.</p>
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
    </div>
  );
}
