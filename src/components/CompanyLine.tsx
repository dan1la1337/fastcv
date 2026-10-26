import Link from "next/link";
import { Hourglass, Reply, ShieldCheck, Star } from "lucide-react";
import { companyHref, hiringLabel, type Vacancy } from "@/lib/vacancies";

/** «обычно за 5 ч» / «обычно за 2 дня» — типичное время ответа работодателя. */
export function replyTime(hours: number): string {
  if (hours < 24) return `обычно за ${hours} ч`;
  const days = Math.round(hours / 24);
  return `обычно за ${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"}`;
}

/** Компания со ссылкой на её страницу и уточнение «кто нанимает» (аутстафф, агентство). */
export default function CompanyLine({ vacancy, className }: {
  vacancy: Pick<Vacancy, "company_name" | "hiring_type" | "source_type" | "employer_verified" | "employer_slow" | "employer_stats">;
  className: string;
}) {
  const label = hiringLabel(vacancy);
  const stats = vacancy.employer_stats ?? {};
  // Значок ответов — только хороший: плохой случай уже показывает «Отвечает редко»
  const replies = !vacancy.employer_slow && stats.rate !== undefined && stats.rate >= 70;
  if (!vacancy.company_name && !label) return null;
  return (
    <p className={className}>
      {vacancy.company_name && (
        <Link href={companyHref(vacancy.company_name)} className="hover:text-teal-300 transition-colors">{vacancy.company_name}</Link>
      )}
      {vacancy.company_name && label && <span className="text-neutral-500"> · </span>}
      {label && <span className="text-neutral-500">{label}</span>}
      {vacancy.employer_verified && (
        <span title="Работодатель подтвердил домен компании" className="ml-2 inline-flex items-center gap-1 align-[-2px] text-xs text-teal-300">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Проверенный работодатель
        </span>
      )}
      {vacancy.employer_slow && (
        <span title="Есть отклики, на которые работодатель не отвечает больше 10 дней" className="ml-2 inline-flex items-center gap-1 align-[-2px] text-xs text-amber-300">
          <Hourglass className="w-3.5 h-3.5" aria-hidden="true" /> Отвечает редко
        </span>
      )}
      {replies && (
        <span title="Доля откликов за 90 дней, на которые работодатель ответил приглашением или отказом" className="ml-2 inline-flex items-center gap-1 align-[-2px] text-xs text-teal-300">
          <Reply className="w-3.5 h-3.5" aria-hidden="true" /> Отвечает на {stats.rate}%{stats.hours ? `, ${replyTime(stats.hours)}` : ""}
        </span>
      )}
      {stats.rating !== undefined && (
        <span title={`Средняя оценка собеседований от кандидатов FastCV (${stats.ratings})`} className="ml-2 inline-flex items-center gap-1 align-[-2px] text-xs text-amber-300">
          <Star className="w-3.5 h-3.5 fill-amber-300" aria-hidden="true" /> {stats.rating.toFixed(1).replace(".", ",")} за собеседования
        </span>
      )}
    </p>
  );
}
