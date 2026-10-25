import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AREAS, DIRECTIONS, plural, VACANCY_FORMS, type Direction } from "@/lib/vacancies";

// Каталог направлений: сколько открытых вакансий в каждом. Пересобирается раз в полчаса.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Вакансии по направлениям — IT, digital и другие профессии | FastCV",
  description:
    "Свежие вакансии из Telegram-каналов, SuperJob, «Работы России» и от работодателей по направлениям: разработка и данные, маркетинг и дизайн, продажи, медицина, логистика, производство и другие.",
  alternates: { canonical: "/jobs" },
};

async function countByDirection(): Promise<Record<string, number>> {
  // Агрегат в базе: вакансий десятки тысяч, читать строки на клиент нельзя
  const { data } = await supabase.from("direction_counts").select("direction, vacancies");
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.direction] = row.vacancies;
  return counts;
}

function Section({ title, items, counts }: { title: string; items: Direction[]; counts: Record<string, number> }) {
  // По числу вакансий, но «Другое» всегда последним
  const sorted = [...items].sort((a, b) =>
    Number(a.id === "other") - Number(b.id === "other") || (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-neutral-400">{title}</h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sorted.map(d => {
          const n = counts[d.id] ?? 0;
          return (
            <li key={d.id}>
              <Link href={`/jobs/${d.id.replace("_", "-")}`}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-white/10 bg-neutral-900/40 hover:bg-neutral-900">
                <span className="font-medium">{d.label}</span>
                <span className="text-xs text-neutral-400 whitespace-nowrap">
                  {n} {plural(n, VACANCY_FORMS)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function JobsIndexPage() {
  const counts = await countByDirection();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <main className="min-h-screen text-neutral-100 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Все вакансии
        </Link>
        <header className="space-y-2">
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Вакансии по направлениям</h1>
          <p className="text-sm text-neutral-400">
            {total} {plural(total, VACANCY_FORMS)} из Telegram-каналов, SuperJob, «Работы России» и от работодателей, обновляется каждые 2 часа.
          </p>
        </header>
        {AREAS.map(a => (
          <Section key={a.id} title={a.label} items={DIRECTIONS.filter(d => d.group === a.id)} counts={counts} />
        ))}
      </div>
    </main>
  );
}
