import Link from "next/link";
import LiveCounter from "@/components/LiveCounter";
import type { LiveStats } from "@/lib/live";
import LandingSections from "@/components/LandingSections";

const EXAMPLE_FEED = [
  { title: "Middle Python Developer", source: "Telegram" },
  { title: "Продуктовый аналитик", source: "Сайт компании" },
  { title: "Бухгалтер", source: "SuperJob" },
  { title: "Инженер-технолог", source: "«Работа России»" },
];

/**
 * Главная страница (макет «Аврора»): обещание, пример ленты, живой счётчик и лендинг.
 * Вошедшим скрыта (.guest-only): им сразу лента.
 */
export default function Hero({ stats }: { stats: LiveStats | null }) {
  return (
    <div className="guest-only showcase">
    <section className="max-w-page mx-auto px-4 pt-10 sm:pt-16 pb-4 space-y-12">
      <div className="flex flex-wrap items-center gap-x-16 gap-y-10">
        <div className="flex-[1_1_480px] min-w-0 space-y-6">
          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight text-neutral-300">
            Вакансии со всего интернета — <span className="text-teal-300">в одном месте</span>
          </h1>
          <p className="text-base sm:text-lg leading-relaxed text-neutral-300 max-w-xl">
            Не нужно обходить Telegram-каналы, сайты компаний и порталы с работой. FastCV сам собирает вакансии
            оттуда в одну ленту — вам остаётся только выбрать.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="#feed" className="lg lg-accent w-full sm:w-auto text-center rounded-full px-6 py-3.5 font-semibold transition-colors">
              Смотреть вакансии
            </a>
            <Link href="/register/form?role=candidate"
              className="lg w-full sm:w-auto text-center rounded-full px-6 py-3.5 text-neutral-100 transition-colors">
              Загрузить резюме
            </Link>
          </div>
          <p className="text-xs text-neutral-500">Сначала короткая регистрация, затем загрузка PDF</p>
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
    <LandingSections />
    </div>
  );
}
