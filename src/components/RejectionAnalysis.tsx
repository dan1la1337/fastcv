"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { fetchRecommended, matchTone, type Match } from "@/lib/matching";
import type { RejectionAnalysis as Analysis } from "@/lib/rejection";
import type { Vacancy } from "@/lib/vacancies";

function Block({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${tone}`}>{title}</p>
      <ul className="text-sm text-neutral-300 space-y-1 list-disc pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** Разбор отказа с ИИ и вакансии, где совпадение выше. */
export default function RejectionAnalysis({ applicationId, vacancyId, initial }: {
  applicationId: string;
  vacancyId: string | null;
  initial: Analysis | null;
}) {
  const [analysis, setAnalysis] = useState<Analysis | null>(initial);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [better, setBetter] = useState<{ v: Vacancy; m: Match }[] | null>(null);

  async function loadBetter(min: number | null | undefined) {
    const found = await fetchRecommended(0, 6).catch(() => null);
    if (!found) return setBetter([]);
    setBetter(found.rows
      .filter(v => v.id !== vacancyId && (found.matches[v.id]?.score ?? 0) > (min ?? 0))
      .slice(0, 3)
      .map(v => ({ v, m: found.matches[v.id] })));
  }

  async function show() {
    setOpen(true);
    if (analysis) {
      if (!better) loadBetter(analysis.match);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rejection-analysis", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не получилось. Попробуйте ещё раз.");
      setAnalysis(data.analysis);
      loadBetter(data.analysis?.match);
    } catch (e) {
      setError(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Нет связи с сервером. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={show}
        className="inline-flex items-center gap-1.5 text-sm text-teal-300 hover:text-teal-200 transition-colors">
        <Sparkles className="w-4 h-4" /> {analysis ? "Разбор отказа" : "Почему отказали? Разбор с ИИ"}
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-indigo-400/25 bg-indigo-400/[0.05] p-4 space-y-4" aria-label="Разбор отказа">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-indigo-200 uppercase tracking-wider inline-flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Разбор отказа
        </p>
        <button onClick={() => setOpen(false)} className="text-xs text-neutral-400 hover:text-white">Свернуть</button>
      </div>
      {busy && <p className="text-sm text-neutral-300 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Сравниваю отклик с вакансией…</p>}
      {error && <p role="alert" className="text-sm text-amber-300">{error} <button onClick={show} className="underline">Повторить</button></p>}
      {analysis && (
        <>
          <p className="text-neutral-100 leading-relaxed">{analysis.summary}</p>
          <Block title="Вероятные причины" tone="text-amber-300" items={analysis.reasons} />
          <Block title="Что было сильным" tone="text-emerald-300" items={analysis.strengths} />
          <Block title="Чего не хватило" tone="text-red-300" items={analysis.gaps} />
          {analysis.letter && <p className="text-sm text-neutral-300"><span className="text-indigo-200">Письмо и ответы: </span>{analysis.letter}</p>}
          <Block title="Что сделать дальше" tone="text-teal-300" items={analysis.next} />
          <p className="text-[11px] text-neutral-500">Настоящую причину знает только работодатель — это вероятные причины по вашему профилю, отклику и вакансии.</p>
          {better && better.length > 0 && (
            <div className="border-t border-white/10 pt-3 space-y-2">
              <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Где ваше совпадение выше</p>
              <ul className="space-y-1.5">
                {better.map(({ v, m }) => (
                  <li key={v.id} className="flex items-center gap-2 text-sm">
                    <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[11px] ${matchTone(m.score)}`}>{m.score}%</span>
                    <Link href={`/vacancy/${v.id}`} className="text-neutral-200 hover:text-teal-300 truncate">
                      {v.title}{v.company_name ? ` · ${v.company_name}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
