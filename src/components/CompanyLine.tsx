import Link from "next/link";
import { companyHref, hiringLabel, type Vacancy } from "@/lib/vacancies";

/** Компания со ссылкой на её страницу и уточнение «кто нанимает» (аутстафф, агентство). */
export default function CompanyLine({ vacancy, className }: {
  vacancy: Pick<Vacancy, "company_name" | "hiring_type" | "source_type">;
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
    </p>
  );
}
