import Link from "next/link";
import LiveCounter from "@/components/LiveCounter";
import MatchRing from "@/components/MatchRing";
import type { LiveStats } from "@/lib/live";
import LandingSections from "@/components/LandingSections";

/**
 * Главная страница (макет «Аврора»): обещание, пример совпадения, живой счётчик и лендинг.
 * На «/» вошедшим скрыта (.guest-only): им сразу лента. На /about видна всем.
 */
export default function Hero({ stats, always = false }: { stats: LiveStats | null; always?: boolean }) {
  const feedHref = always ? "/#feed" : "#feed";
  return (
    <div className={always ? "" : "guest-only"}>
    <section className="max-w-6xl mx-auto px-4 pt-10 sm:pt-16 pb-4 space-y-12">
      <div className="flex flex-wrap items-center gap-x-16 gap-y-10">
        <div className="flex-[1_1_480px] min-w-0 space-y-6">
          <h1 className="font-display text-4xl sm:text-5xl lg:text-[56px] font-bold leading-[1.1] tracking-tight text-neutral-300">
            Работа, которая подходит вам на <span className="text-teal-300">92%</span>
          </h1>
          <p className="text-lg leading-relaxed text-neutral-400 max-w-xl">
            Загрузите резюме — ИИ прочитает его, пройдёт по всем вакансиям из Telegram, сайтов компаний,
            SuperJob и «Работы России» и объяснит, почему каждая вам подходит и чего не хватает.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/register/form?role=candidate"
              className="lg lg-accent rounded-full px-6 py-3.5 font-semibold transition-colors">
              Загрузить резюме
            </Link>
            <a href={feedHref} className="lg rounded-full px-6 py-3.5 text-neutral-100 transition-colors">
              Смотреть вакансии
            </a>
          </div>
        </div>

        <figure className="neu-sub flex-[0_1_460px] min-w-0 m-0 rounded-3xl p-6 sm:p-7 space-y-5">
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
              <span key={s} className="neu-chip px-2 py-1 text-[11px] !text-teal-200 !border-teal-300/40">{s} ✓</span>
            ))}
            <span className="neu-chip px-2 py-1 text-[11px] !text-amber-300 !border-amber-300/40">SQLAlchemy — добавить?</span>
          </div>
        </figure>
      </div>

      {stats && <LiveCounter initial={stats} />}
    </section>
    <LandingSections />
    </div>
  );
}
