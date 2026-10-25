import Link from "next/link";
import LiveCounter from "@/components/LiveCounter";
import MatchRing from "@/components/MatchRing";
import type { LiveStats } from "@/lib/live";

/**
 * Первый экран для гостей (редизайн «Аврора»): обещание, пример совпадения и живой счётчик.
 * Вошедшим скрыт (.guest-only): им сразу лента.
 */
export default function Hero({ stats }: { stats: LiveStats | null }) {
  return (
    <section className="guest-only max-w-6xl mx-auto px-4 pt-10 sm:pt-16 pb-4 space-y-12">
      <div className="flex flex-wrap items-center gap-x-16 gap-y-10">
        <div className="flex-[1_1_480px] min-w-0 space-y-6">
          <h1 className="font-display text-4xl sm:text-5xl lg:text-[56px] font-bold leading-[1.1] tracking-tight">
            Работа, которая подходит вам на <span className="text-teal-300">92%</span>
          </h1>
          <p className="text-lg leading-relaxed text-neutral-400 max-w-xl">
            Загрузите резюме — ИИ прочитает его, пройдёт по всем вакансиям из Telegram, сайтов компаний,
            SuperJob и «Работы России» и объяснит, почему каждая вам подходит и чего не хватает.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/register/form?role=candidate"
              className="rounded-full bg-teal-300 px-6 py-3.5 font-semibold text-neutral-950 hover:bg-teal-200 transition-colors">
              Загрузить резюме
            </Link>
            <a href="#feed" className="rounded-full border border-white/20 px-6 py-3.5 text-neutral-100 hover:border-white/40 transition-colors">
              Смотреть вакансии
            </a>
          </div>
        </div>

        <figure className="flex-[0_1_460px] min-w-0 m-0 rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-7 space-y-5 backdrop-blur">
          <figcaption className="text-xs uppercase tracking-wider text-neutral-500">Пример подборки</figcaption>
          <div className="flex items-center gap-6">
            <MatchRing value={92} size={140} />
            <div className="space-y-1.5">
              <p className="text-sm text-neutral-400">Банк 131 · удалённо</p>
              <p className="text-xl font-semibold leading-snug">Middle Python Developer</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {["Python", "FastAPI", "3+ года"].map(s => (
              <span key={s} className="rounded-full bg-teal-300/15 px-3 py-1 text-teal-200">{s} ✓</span>
            ))}
            <span className="rounded-full bg-amber-400/15 px-3 py-1 text-amber-300">SQLAlchemy — добавить?</span>
          </div>
        </figure>
      </div>

      {stats && <LiveCounter initial={stats} />}
    </section>
  );
}
