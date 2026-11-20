import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CatalogPager from "@/components/CatalogPager";
import PageBar from "@/components/PageBar";
import { pageCount, pageHref, parsePage } from "@/lib/catalog-pages";
import { cachedCompanyRating, cachedCompanyVacancies } from "@/lib/public-data";
import { plural, VACANCY_FORMS } from "@/lib/vacancies";
import VacancyListStatic from "@/components/VacancyListStatic";
import CompanyRatingCard from "@/components/CompanyRatingCard";

type Props = { params: Promise<{ name: string }>; searchParams: Promise<{ page?: string | string[] }> };

export const revalidate = 1800;

const nameFrom = async (params: Props["params"]) => decodeURIComponent((await params).name).trim().slice(0, 200);

const getRating = cachedCompanyRating;

/** Вакансии страницы и общее число; page null — в ?page мусор или страница за последней. */
async function load({ params, searchParams }: Props) {
  const name = await nameFrom(params);
  const page = parsePage((await searchParams).page);
  if (!page) return { name, page: null };
  const { vacancies, hasNext, total: count } = await cachedCompanyVacancies(name, page);
  if (page > 1 && !vacancies.length) return { name, page: null };
  const { total, pages } = pageCount(page, vacancies.length, hasNext, count);
  return { name, page, pages, total, vacancies, base: `/company/${encodeURIComponent(name)}` };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const data = await load(props);
  if (!data.page) return { title: "Компания не найдена — FastCV", robots: { index: false } };
  const { name, page, total, vacancies, base } = data;
  if (!vacancies.length) {
    return (await getRating(name))
      ? { title: `Рейтинг найма ${name} — FastCV`, description: `Как ${name} отвечает на отклики и проводит собеседования: отзывы кандидатов FastCV.` }
      : { title: "Компания не найдена — FastCV", robots: { index: false } };
  }
  const company = vacancies[0].company_name ?? name;
  const suffix = page > 1 ? ` — страница ${page}` : "";
  const title = `Вакансии ${company}${suffix} — FastCV`;
  const description = `${total} ${plural(total, VACANCY_FORMS)} компании ${company}: должности, зарплаты, формат работы. Отклик с сопроводительным письмом от ИИ.`;
  return { title, description, alternates: { canonical: pageHref(base, page) }, openGraph: { title, description } };
}

export default async function CompanyPage(props: Props) {
  const data = await load(props);
  if (!data.page) notFound();
  const { name, page, pages, total, vacancies, base } = data;
  const rating = await getRating(name);
  if (!vacancies.length && !rating) notFound();
  const company = vacancies[0]?.company_name ?? name;

  return (
    <>
      <PageBar href="/" label="Все вакансии" />
      <main className="min-h-screen text-neutral-100 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-bold">{company}</h1>
          <p className="text-sm text-neutral-400">
            {total} {plural(total, ["открытая вакансия", "открытые вакансии", "открытых вакансий"])}
            {pages > 1 && <> · страница {page} из {pages}</>}
          </p>
        </header>
        {vacancies.length > 0 && <VacancyListStatic vacancies={vacancies} />}
        <CatalogPager base={base} page={page} pages={pages} />
        {rating && <CompanyRatingCard company={company} rating={rating} />}
      </div>
    </main>
      </>
  );
}
