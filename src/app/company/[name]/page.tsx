import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { VACANCY_COLUMNS, plural, VACANCY_FORMS, type Vacancy } from "@/lib/vacancies";
import VacancyListStatic from "@/components/VacancyListStatic";

type Props = { params: Promise<{ name: string }> };

export const revalidate = 1800;

const nameFrom = async (params: Props["params"]) => decodeURIComponent((await params).name).trim().slice(0, 200);

// Название компании сравнивается без учёта регистра; % и _ — не шаблоны
const getVacancies = cache(async (name: string): Promise<Vacancy[]> => {
  if (!name) return [];
  const { data } = await supabase
    .from("vacancies")
    .select(VACANCY_COLUMNS)
    .is("archived_at", null)
    .ilike("company_name", name.replace(/[%_\\]/g, "\\$&"))
    .order("created_at", { ascending: false })
    .limit(60);
  return (data ?? []) as Vacancy[];
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = await nameFrom(params);
  const vacancies = await getVacancies(name);
  if (!vacancies.length) return { title: "Компания не найдена — FastCV", robots: { index: false } };
  const company = vacancies[0].company_name ?? name;
  const title = `Вакансии ${company} — FastCV`;
  const description = `${vacancies.length} ${plural(vacancies.length, VACANCY_FORMS)} компании ${company}: должности, зарплаты, формат работы. Отклик с сопроводительным письмом от ИИ.`;
  return { title, description, openGraph: { title, description } };
}

export default async function CompanyPage({ params }: Props) {
  const name = await nameFrom(params);
  const vacancies = await getVacancies(name);
  if (!vacancies.length) notFound();
  const company = vacancies[0].company_name ?? name;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Все вакансии
        </Link>
        <header className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold">{company}</h1>
          <p className="text-sm text-neutral-400">{vacancies.length} {plural(vacancies.length, ["открытая вакансия", "открытые вакансии", "открытых вакансий"])}</p>
        </header>
        <VacancyListStatic vacancies={vacancies} />
      </div>
    </main>
  );
}
