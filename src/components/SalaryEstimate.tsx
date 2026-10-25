import { formatEstimate, type SalaryEstimate as Estimate } from "@/lib/salary";
import { plural } from "@/lib/vacancies";

/** Пунктирная плашка «≈ 70–120 тыс. ₽ · оценка по 152 вакансиям» вместо пустого места. */
export default function SalaryEstimate({ estimate, className = "" }: { estimate: Estimate; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-white/15 text-neutral-300 font-normal ${className}`}
      title="Работодатель не указал зарплату. Оценка — середина вилок похожих вакансий (то же направление и уровень) за 90 дней"
    >
      {formatEstimate(estimate)}
      <span className="text-neutral-500">· оценка по {estimate.sample} {plural(estimate.sample, ["вакансии", "вакансиям", "вакансиям"])}</span>
    </span>
  );
}
