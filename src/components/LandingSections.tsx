import Link from "next/link";

const STEPS = [
  { n: "01", title: "Загрузите резюме", text: "ИИ заполнит профиль: опыт, навыки, уровень, город и желаемую зарплату. Всё можно поправить." },
  { n: "02", title: "Смотрите совпадение", text: "У каждой вакансии — процент и объяснение. Недостающий навык добавляется в профиль одной кнопкой." },
  { n: "03", title: "Откликайтесь с письмом", text: "Smart Apply пишет сопроводительное под вакансию: тон, длина и язык — на ваш выбор." },
];

const SOURCES = [
  { title: "Telegram", text: "Публичные каналы с вакансиями по всем профессиям" },
  { title: "Сайты компаний", text: "VK, Авито, Т-Банк, Сбер, X5 Tech, 2ГИС и другие — со ссылкой на страницу работодателя" },
  { title: "SuperJob", text: "Через официальный API" },
  { title: "«Работа России»", text: "Открытые данные портала" },
];

/** Лендинг под первым экраном (макет «Аврора»): как это работает, источники, работодателям. */
export default function LandingSections({ className = "" }: { className?: string }) {
  return (
    <div className={`max-w-6xl mx-auto px-4 space-y-20 sm:space-y-24 pt-16 pb-8 ${className}`}>
      <section aria-labelledby="how" className="space-y-8">
        <h2 id="how" className="font-display text-2xl sm:text-4xl font-bold leading-tight">От резюме до отклика — без лишних шагов</h2>
        <ol className="grid gap-4 sm:grid-cols-3 list-none p-0 m-0">
          {STEPS.map(s => (
            <li key={s.n} className="glass rounded-3xl p-6 space-y-2.5">
              <p className="font-mono text-sm text-teal-300">{s.n}</p>
              <h3 className="text-xl font-semibold">{s.title}</h3>
              <p className="text-neutral-400 leading-relaxed">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="sources" aria-labelledby="sources-title" className="flex flex-wrap gap-8 scroll-mt-20">
        <div className="flex-[1_1_320px] min-w-0 space-y-4">
          <h2 id="sources-title" className="font-display text-2xl sm:text-4xl font-bold leading-tight">Откуда вакансии</h2>
          <p className="text-neutral-400 leading-relaxed">
            Только открытые источники и официальные API. У каждой вакансии — ссылка на оригинал. Владелец канала может исключить его в любой момент.
          </p>
          <Link href="/sources" className="inline-block font-semibold text-teal-200 hover:text-white">Как мы работаем с источниками →</Link>
        </div>
        <div className="flex-[1_1_520px] min-w-0 grid gap-3 sm:grid-cols-2">
          {SOURCES.map(s => (
            <div key={s.title} className="glass rounded-3xl p-5">
              <h3 className="font-semibold mb-1.5">{s.title}</h3>
              <p className="text-sm text-neutral-400 leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="employers" className="rounded-[28px] p-8 sm:p-10 border border-white/12 bg-[linear-gradient(135deg,rgba(94,234,212,0.12),rgba(99,102,241,0.12))] flex flex-wrap items-center gap-8">
        <div className="flex-[1_1_420px] min-w-0 space-y-4">
          <h2 id="employers" className="font-display text-2xl sm:text-3xl font-bold leading-tight">Работодателям: ни один отклик не потеряется</h2>
          <p className="text-neutral-300 leading-relaxed">
            Отклики отсортированы по совпадению с вакансией, воронка и ответ кандидату в один клик. Место кандидата зависит только от совпадения — не от оплаты.
          </p>
        </div>
        <Link href="/register/form?role=employer" className="rounded-full bg-neutral-100 hover:bg-white px-6 py-3.5 font-semibold text-neutral-950 transition-colors">
          Разместить вакансию
        </Link>
      </section>
    </div>
  );
}
