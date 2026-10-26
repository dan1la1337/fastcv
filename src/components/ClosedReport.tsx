"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isNetworkError } from "@/lib/auth-errors";

/** Кнопка «Вакансия уже закрыта» (детектор вакансий-призраков, план 1.14). */
export default function ClosedReport({ vacancyId }: { vacancyId: string }) {
  const [state, setState] = useState<"anon" | "idle" | "busy" | "done" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return !cancelled && setState("anon");
      const { data } = await supabase.rpc("my_closed_report", { vacancy: vacancyId });
      if (!cancelled) setState(data ? "done" : "idle");
    });
    return () => { cancelled = true; };
  }, [vacancyId]);

  async function report() {
    setState("busy");
    setError(null);
    const { error } = await supabase.rpc("report_vacancy_closed", { vacancy: vacancyId });
    if (error) {
      setState("idle");
      const m = error.message.match(/closed_report: (.+)/);
      setError(isNetworkError(error.message) ? "Нет связи с сервером. Попробуйте ещё раз." : m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) + "." : "Не получилось. Попробуйте ещё раз.");
      return;
    }
    setState("done");
  }

  if (state === null) return null;
  if (state === "anon") {
    return (
      <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors">
        <Ban className="w-4 h-4" aria-hidden="true" /> Вакансия уже закрыта?
      </Link>
    );
  }
  return (
    <span className="inline-flex flex-col">
      {state === "done" ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
          <Check className="w-4 h-4" aria-hidden="true" /> Спасибо, отметка учтена
        </span>
      ) : (
        <button type="button" onClick={report} disabled={state === "busy"}
          title="От трёх отметок вакансия из внешнего источника уходит в архив"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white disabled:opacity-50 transition-colors">
          {state === "busy" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" aria-hidden="true" />} Вакансия уже закрыта
        </button>
      )}
      {error && <span role="alert" className="text-xs text-amber-300 mt-1">{error}</span>}
    </span>
  );
}
