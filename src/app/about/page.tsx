import type { Metadata } from "next";
import Link from "next/link";
import { EmployersSection, SourcesSection } from "@/components/LandingSections";
import LiveCounter from "@/components/LiveCounter";
import Logo from "@/components/Logo";
import { fetchLiveStats } from "@/lib/live";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "О сервисе — FastCV",
  description: "FastCV собирает вакансии из Telegram, сайтов компаний, SuperJob и «Работы России» в одну ленту: не нужно искать работу по всему интернету.",
  alternates: { canonical: "/about" },
};

const EXAMPLE_FEED = [
  { title: "Middle Python Developer", source: "Telegram" },
  { title: "Продуктовый аналитик", source: "Сайт компании" },
  { title: "Бухгалтер", source: "SuperJob" },
  { title: "Инженер-технолог", source: "«Работа России»" },
];

/** Страница «О сервисе» для всех, в том числе вошедших: суть FastCV — вакансии в одной ленте. */
export default async function AboutPage() {
  const stats = await fetchLiveStats().catch(() => null);
  return (
    <div className="min-h-screen text-neutral-100">
      <header className="sticky top-0 z-20 px-3 sm:px-4 pt-3">
        <div className="glass rounded-3xl max-w-6xl mx-auto pl-4 pr-2.5 py-2.5 flex items-center justify-between gap-3">
          <Logo />
          <Link href="/" className="lg lg-accent px-4 py-2 rounded-full text-sm font-semibold transition-colors">
            К вакансиям
          </Link>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 pt-10 sm:pt-16 pb-4 space-y-12">
        <div className="flex flex-wrap items-center gap-x-16 gap-y-10">
          <div className="flex-[1_1_480px] min-w-0 space-y-6">
            <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight text-neutral-300">
              Вакансии со всего интернета — <span className="text-teal-300">в одном месте</span>
            </h1>
            <p className="text-lg leading-relaxed text-neutral-400 max-w-xl">
              Не нужно обходить Telegram-каналы, сайты компаний и порталы с работой. FastCV сам собирает вакансии
              оттуда в одну ленту — вам остаётся только выбрать.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/#feed" className="lg lg-accent rounded-full px-6 py-3.5 font-semibold transition-colors">
                Смотреть вакансии
              </Link>
              <Link href="/register/form?role=candidate" className="lg rounded-full px-6 py-3.5 text-neutral-100 transition-colors">
                Загрузить резюме
              </Link>
            </div>
          </div>

          <figure className="neu-sub flex-[0_1_460px] min-w-0 m-0 rounded-3xl p-6 sm:p-7 space-y-5">
            <figcaption className="text-xs uppercase tracking-wider text-neutral-500">Пример: одна лента, разные источники</figcaption>
            <ul className="space-y-3 list-none p-0 m-0">
              {EXAMPLE_FEED.map(v => (
                <li key={v.source} className="flex items-center justify-between gap-3">
                  <span className="font-semibold leading-snug min-w-0">{v.title}</span>
                  <span className="neu-chip px-2 py-1 text-xs shrink-0">{v.source}</span>
                </li>
              ))}
            </ul>
          </figure>
        </div>

        {stats && <LiveCounter initial={stats} />}
      </section>

      <div className="max-w-6xl mx-auto px-4 space-y-20 sm:space-y-24 pt-16 pb-8">
        <SourcesSection />

        <section aria-labelledby="extras" className="neu-sub rounded-3xl p-8 sm:p-10 space-y-4">
          <h2 id="extras" className="font-display text-xl font-bold leading-tight">Нашли вакансию? Дальше тоже поможем</h2>
          <p className="text-neutral-300 leading-relaxed">
            Покажем, насколько она подходит вашему резюме, напишем сопроводительное письмо и потренируем перед собеседованием.
          </p>
        </section>

        <EmployersSection />
      </div>
    </div>
  );
}
