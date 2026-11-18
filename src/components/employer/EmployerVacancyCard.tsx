import Link from "next/link";
import { Archive, Eye, Pencil, RotateCcw } from "lucide-react";
import VacancyInsights from "@/components/VacancyInsights";
import { vacancyFunnel, type Application } from "@/lib/employer";
import type { Match } from "@/lib/matching";
import type { SalaryBenchmark } from "@/lib/salary";
import { formatSalary, plural, type Vacancy } from "@/lib/vacancies";

/** Вакансия в кабинете: действия, воронка и сравнение с рынком. */
export default function EmployerVacancyCard({ vacancy: v, forVacancy, matches, benchmarks, onEdit, onArchive }: {
  vacancy: Vacancy;
  /** Отклики на эту вакансию. */
  forVacancy: Application[];
  matches: Record<string, Match>;
  benchmarks: SalaryBenchmark[];
  onEdit: (vacancy: Vacancy) => void;
  onArchive: (vacancy: Vacancy, archived: boolean) => void;
}) {
  const views = v.views_count ?? 0;
  const { steps, top } = vacancyFunnel(views, forVacancy);
  return (
    <div className={`glass rounded-3xl p-5 sm:p-6 space-y-4 ${v.archived_at ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[14rem]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-bold text-white">{v.title}</h3>
            {v.archived_at && <span className="text-xs px-2.5 py-0.5 rounded-full neu-chip text-neutral-400">закрыта</span>}
          </div>
          <p className="text-sm text-neutral-400 mt-1">
            {formatSalary(v.salary_min, v.salary_max, v.salary_currency)}
            {v.city ? ` · ${v.city}` : ""}{v.is_remote ? " · удалённо" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href={`/vacancy/${v.id}`} title="Открыть страницу вакансии" aria-label="Открыть страницу вакансии"
            className="lg w-10 h-10 inline-flex items-center justify-center rounded-full text-neutral-400 hover:text-white"><Eye className="w-4 h-4" /></Link>
          <button onClick={() => onEdit(v)} title="Редактировать" aria-label="Редактировать"
            className="lg w-10 h-10 inline-flex items-center justify-center rounded-full text-neutral-400 hover:text-white"><Pencil className="w-4 h-4" /></button>
          {v.archived_at ? (
            <button onClick={() => onArchive(v, false)}
              className="lg inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-sm text-neutral-300 hover:text-white">
              <RotateCcw className="w-3.5 h-3.5" /> Открыть снова
            </button>
          ) : (
            <button onClick={() => onArchive(v, true)}
              className="lg inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-sm text-neutral-300 hover:text-red-300">
              <Archive className="w-3.5 h-3.5" /> Закрыть
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2 text-sm" aria-label="Воронка вакансии">
        {steps.map((f, i) => (
          <div key={f.label} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-3">
            <span className="text-neutral-400">{f.label}</span>
            <span className="h-2.5 rounded-r-md neu-chip overflow-hidden">
              <span className={`bar-grow block h-full rounded-r-md ${f.color}`}
                style={{ width: `${Math.max(f.value ? 2 : 0, (f.value / top) * 100)}%`, animationDelay: `${i * 0.15}s` }} />
            </span>
            <span className="text-right tabular-nums" title={`${f.value} ${plural(f.value, f.word)}`}>{f.value}</span>
          </div>
        ))}
      </div>
      {!v.archived_at && (
        <VacancyInsights benchmarks={benchmarks} vacancy={{
          id: v.id, salary_min: v.salary_min, salary_max: v.salary_max, salary_currency: v.salary_currency,
          direction: v.direction ?? null, level: v.level ?? null, views,
          applications: forVacancy.map(a => ({ status: a.status, created_at: a.created_at })),
          matchScores: forVacancy.map(a => matches[a.id]?.score).filter((x): x is number => typeof x === "number"),
        }} />
      )}
    </div>
  );
}
