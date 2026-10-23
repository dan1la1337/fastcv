import Link from "next/link";
import { Briefcase, Building2, Globe, MapPin } from "lucide-react";
import { formatLabel, formatSalary, levelLabel, type Vacancy } from "@/lib/vacancies";
import CompanyLine from "@/components/CompanyLine";

/**
 * Список вакансий без JavaScript — для страниц направлений и компаний:
 * отрисовывается на сервере целиком и индексируется поисковиками.
 */
export default function VacancyListStatic({ vacancies }: { vacancies: Vacancy[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {vacancies.map(v => (
        <li key={v.id} className="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-5">
          <h2 className="text-lg font-bold text-neutral-100">
            <Link href={`/vacancy/${v.id}`} className="hover:text-blue-400 transition-colors">{v.title}</Link>
          </h2>
          <CompanyLine vacancy={v} className="text-sm text-neutral-400 mt-0.5" />
          <p className="text-sm font-semibold text-emerald-400 mt-1">{formatSalary(v.salary_min, v.salary_max, v.salary_currency)}</p>
          <p className="flex flex-wrap items-center gap-3 text-xs text-neutral-400 mt-2">
            {v.level && <span className="inline-flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" />{levelLabel(v.level)}</span>}
            {v.city && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{v.city}</span>}
            {v.work_format === "remote" || (!v.work_format && v.is_remote)
              ? <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" />Удалённо</span>
              : v.work_format && <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{formatLabel(v.work_format)}</span>}
          </p>
          {v.description && <p className="text-sm text-neutral-400 leading-relaxed line-clamp-2 mt-2">{v.description}</p>}
        </li>
      ))}
    </ul>
  );
}
