import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { companyHref, hiringLabel, type Vacancy } from "@/lib/vacancies";

/** Компания со ссылкой на её страницу и уточнение «кто нанимает» (аутстафф, агентство). */
export default function CompanyLine({ vacancy, className }: {
  vacancy: Pick<Vacancy, "company_name" | "hiring_type" | "source_type" | "employer_verified">;
  className: string;
}) {
  const label = hiringLabel(vacancy);
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
    </p>
  );
}
