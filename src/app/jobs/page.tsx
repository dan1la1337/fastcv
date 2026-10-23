import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DIRECTIONS, plural, VACANCY_FORMS, type Direction } from "@/lib/vacancies";

// Каталог направлений: сколько открытых вакансий в каждом. Пересобирается раз в полчаса.
export const revalidate = 1800;

export const metadata: Metadata = {
  title: "Вакансии по направлениям — IT и не только | FastCV",
  description:
    "Свежие вакансии из Telegram-каналов и от работодателей по направлениям: backend, frontend, мобильная разработка, QA, DevOps, Data/ML, аналитика и другие.",
  alternates: { canonical: "/jobs" },
};

async function countByDirection(): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("vacancies")
    .select("direction")
    .is("archived_at", null)
    .not("direction", "is", null)
    .limit(5000);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row.direction) counts[row.direction] = (counts[row.direction] ?? 0) + 1;
  }
  return counts;
}

function Section({ title, items, counts }: { title: string; items: Direction[]; counts: Record<string, number> }) {
  const sorted = [...items].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-neutral-400">{title}</h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sorted.map(d => {
          const n = counts[d.id] ?? 0;
          return (
            <li key={d.id}>
              <Link href={`/jobs/${d.id.replace("_", "-")}`}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-900">
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
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Все вакансии
        </Link>
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">Вакансии по направлениям</h1>
          <p className="text-sm text-neutral-400">
            {total} {plural(total, VACANCY_FORMS)} из Telegram-каналов и от работодателей, обновляется несколько раз в день.
          </p>
        </header>
        <Section title="IT" items={DIRECTIONS.filter(d => d.group === "it")} counts={counts} />
        <Section title="Другие направления" items={DIRECTIONS.filter(d => d.group !== "it")} counts={counts} />
      </div>
    </main>
  );
}
