"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { benchmarkFor, vacancyInsights, type Insight, type InsightInput } from "@/lib/insights";
import type { SalaryBenchmark } from "@/lib/salary";

const ICON = { good: CheckCircle2, warn: AlertTriangle, info: Info };
const TONE = { good: "text-emerald-300", warn: "text-amber-300", info: "text-indigo-200" };

/** Подсказки по вакансии в кабинете: рынок зарплат, конверсия, ответы, конкуренция. */
export default function VacancyInsights({ vacancy, benchmarks }: {
  vacancy: Omit<InsightInput, "competitors"> & { id: string };
  benchmarks: SalaryBenchmark[];
}) {
  const [competitors, setCompetitors] = useState<number | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!vacancy.direction || vacancy.direction === "other") return;
    let alive = true;
    let query = supabase.from("vacancies").select("id", { count: "exact", head: true })
      .eq("direction", vacancy.direction).is("archived_at", null).neq("id", vacancy.id)
      .gte("created_at", new Date(now - 30 * 864e5).toISOString());
    if (vacancy.level) query = query.eq("level", vacancy.level);
    query.then(({ count }) => { if (alive) setCompetitors(count ?? null); });
    return () => { alive = false; };
  }, [vacancy.id, vacancy.direction, vacancy.level, now]);

  const insights: Insight[] = vacancyInsights({ ...vacancy, competitors }, benchmarkFor(vacancy.direction, vacancy.level, benchmarks), now);
  if (!insights.length) return null;
  return (
    <ul className="grid sm:grid-cols-2 gap-2" aria-label="Аналитика вакансии">
      {insights.map(x => {
        const Icon = ICON[x.tone];
        return (
          <li key={x.title} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
            <p className={`font-semibold inline-flex items-center gap-1.5 ${TONE[x.tone]}`}><Icon className="w-4 h-4" aria-hidden="true" /> {x.title}</p>
            <p className="text-neutral-300 mt-1 leading-relaxed">{x.text}</p>
          </li>
        );
      })}
    </ul>
  );
}
