import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CatalogPager from "@/components/CatalogPager";
import PageBar from "@/components/PageBar";
import { pageCount, pageHref, parsePage } from "@/lib/catalog-pages";
import { cachedDirectionCounts, cachedDirectionVacancies } from "@/lib/public-data";
import { DIRECTIONS, plural, VACANCY_FORMS } from "@/lib/vacancies";
import VacancyListStatic from "@/components/VacancyListStatic";

type Props = { params: Promise<{ direction: string }>; searchParams: Promise<{ page?: string | string[] }> };

// Страница направления пересобирается раз в полчаса: вакансии приходят каждые 6 часов
export const revalidate = 1800;
export const dynamicParams = false;

export function generateStaticParams() {
  return DIRECTIONS.map(d => ({ direction: d.id.replace("_", "-") }));
}

const byParam = (param: string) => DIRECTIONS.find(d => d.id === param.replace("-", "_"));

/** Направление, номер страницы, вакансии страницы и общее число; null — такой страницы нет. */
async function load({ params, searchParams }: Props) {
  const slug = (await params).direction;
  const direction = byParam(slug);
  const page = parsePage((await searchParams).page);
  if (!direction || !page) return null;
  const [{ vacancies, hasNext }, counts] = await Promise.all([
    cachedDirectionVacancies(direction.id, page), cachedDirectionCounts()]);
  // Пустая — только первая страница («вакансий пока нет»), за последней — 404
  if (page > 1 && !vacancies.length) return null;
  const { total, pages } = pageCount(page, vacancies.length, hasNext, counts[direction.id] ?? null);
  return { direction, base: `/jobs/${slug}`, page, pages, total, vacancies };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const data = await load(props);
  if (!data) return {};
  const { direction, base, page, total } = data;
  const suffix = page > 1 ? ` — страница ${page}` : "";
  const title = `Вакансии: ${direction.label} — удалённо и в офисе${suffix} | FastCV`;
  const description = `${total} ${plural(total, VACANCY_FORMS)} по направлению «${direction.label}» из Telegram-каналов, SuperJob, «Работы России» и от работодателей. Отклик с сопроводительным письмом от ИИ.`;
  return { title, description, alternates: { canonical: pageHref(base, page) }, openGraph: { title, description } };
}

export default async function DirectionPage(props: Props) {
  const data = await load(props);
  if (!data) notFound();
  const { direction, base, page, pages, total, vacancies } = data;

  const remote = vacancies.filter(v => v.work_format === "remote" || v.is_remote).length;
  const cities = Object.entries(
    vacancies.reduce<Record<string, number>>((acc, v) => (v.city ? { ...acc, [v.city]: (acc[v.city] ?? 0) + 1 } : acc), {}),
  ).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <>
      <PageBar href="/" label="Все вакансии" />
      <main className="min-h-screen text-neutral-100 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Вакансии: {direction.label}</h1>
          <p className="text-sm text-neutral-400">
            {total} {plural(total, VACANCY_FORMS)}
            {pages > 1 && <> · страница {page} из {pages}</>}
            {vacancies.length > 0 && <> · на странице удалённо — {remote}</>}
            {cities.length > 0 && <> · {cities.map(([city, n]) => `${city} ${n}`).join(", ")}</>}
          </p>
          {direction.tech && (
            <p className="text-xs text-neutral-500">Чаще всего ищут: {direction.tech.join(", ")}</p>
          )}
        </header>

        {vacancies.length ? (
          <>
            <VacancyListStatic vacancies={vacancies} />
            <CatalogPager base={base} page={page} pages={pages} />
          </>
        ) : (
          <p className="text-sm text-neutral-400 py-10 text-center border border-dashed border-white/10 rounded-2xl">
            Сейчас открытых вакансий нет — новые приходят каждые несколько часов.
          </p>
        )}

        <nav className="pt-6 border-t border-white/10" aria-label="Другие направления">
          <p className="text-xs text-neutral-500 mb-3">
            Другие направления · <Link href="/jobs" className="underline hover:text-neutral-300">все направления</Link>
          </p>
          <div className="flex flex-wrap gap-2">
            {DIRECTIONS.filter(d => d.id !== direction.id).map(d => (
              <Link key={d.id} href={`/jobs/${d.id.replace("_", "-")}`}
                className="lg text-xs px-3 py-1.5 rounded-lg text-neutral-300">
                {d.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </main>
      </>
  );
}
