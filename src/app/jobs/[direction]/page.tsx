import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DIRECTIONS, VACANCY_COLUMNS, plural, VACANCY_FORMS, type Vacancy } from "@/lib/vacancies";
import VacancyListStatic from "@/components/VacancyListStatic";

type Props = { params: Promise<{ direction: string }> };

// Страница направления пересобирается раз в полчаса: вакансии приходят каждые 6 часов
export const revalidate = 1800;
export const dynamicParams = false;

export function generateStaticParams() {
  return DIRECTIONS.map(d => ({ direction: d.id.replace("_", "-") }));
}

const byParam = (param: string) => DIRECTIONS.find(d => d.id === param.replace("-", "_"));

const getVacancies = cache(async (direction: string): Promise<Vacancy[]> => {
  const { data } = await supabase
    .from("vacancies")
    .select(VACANCY_COLUMNS)
    .is("archived_at", null)
    .eq("direction", direction)
    .order("ranking_weight", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(60);
  return (data ?? []) as Vacancy[];
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const direction = byParam((await params).direction);
  if (!direction) return {};
  const count = (await getVacancies(direction.id)).length;
  const title = `Вакансии: ${direction.label} — удалённо и в офисе | FastCV`;
  const description = `${count} свежих ${plural(count, VACANCY_FORMS)} по направлению «${direction.label}» из Telegram-каналов, «Работы России» и от работодателей. Отклик с сопроводительным письмом от ИИ.`;
  return { title, description, alternates: { canonical: `/jobs/${(await params).direction}` }, openGraph: { title, description } };
}

export default async function DirectionPage({ params }: Props) {
  const direction = byParam((await params).direction);
  if (!direction) notFound();
  const vacancies = await getVacancies(direction.id);

  const remote = vacancies.filter(v => v.work_format === "remote" || v.is_remote).length;
  const cities = Object.entries(
    vacancies.reduce<Record<string, number>>((acc, v) => (v.city ? { ...acc, [v.city]: (acc[v.city] ?? 0) + 1 } : acc), {}),
  ).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Все вакансии
        </Link>
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">Вакансии: {direction.label}</h1>
          <p className="text-sm text-neutral-400">
            {vacancies.length} {plural(vacancies.length, VACANCY_FORMS)}
            {vacancies.length > 0 && <> · удалённо — {remote}</>}
            {cities.length > 0 && <> · {cities.map(([city, n]) => `${city} ${n}`).join(", ")}</>}
          </p>
          {direction.tech && (
            <p className="text-xs text-neutral-500">Чаще всего ищут: {direction.tech.join(", ")}</p>
          )}
        </header>

        {vacancies.length ? (
          <VacancyListStatic vacancies={vacancies} />
        ) : (
          <p className="text-sm text-neutral-400 py-10 text-center border border-dashed border-neutral-800 rounded-2xl">
            Сейчас открытых вакансий нет — новые приходят каждые несколько часов.
          </p>
        )}

        <nav className="pt-6 border-t border-neutral-800" aria-label="Другие направления">
          <p className="text-xs text-neutral-500 mb-3">
            Другие направления · <Link href="/jobs" className="underline hover:text-neutral-300">все направления</Link>
          </p>
          <div className="flex flex-wrap gap-2">
            {DIRECTIONS.filter(d => d.id !== direction.id).map(d => (
              <Link key={d.id} href={`/jobs/${d.id.replace("_", "-")}`}
                className="text-xs px-3 py-1.5 rounded-lg border border-neutral-800 text-neutral-300 hover:bg-neutral-900">
                {d.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </main>
  );
}
