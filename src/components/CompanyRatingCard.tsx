import { CheckCircle2, Ghost, MessageSquareQuote, Reply, ShieldCheck, Sparkles, Star, Timer, TrendingDown, TrendingUp } from "lucide-react";
import MatchRing from "@/components/MatchRing";
import { plural } from "@/lib/vacancies";
import { hoursLabel, scoreLabel, stageLabel, type CompanyRating } from "@/lib/rating";

function Stars({ value, size = "w-4 h-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex" aria-label={`${value} из 5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} aria-hidden="true" className={`${size} ${n <= Math.round(value) ? "fill-amber-300 text-amber-300" : "text-neutral-600"}`} />
      ))}
    </span>
  );
}

const date = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** Рейтинг работодателя на странице компании: итоговый балл, из чего он складывается, отзывы. */
export default function CompanyRatingCard({ company, rating }: { company: string; rating: CompanyRating }) {
  const signals = [
    rating.reply_rate !== undefined && {
      icon: Reply, label: "Отвечает на отклики", value: `${rating.reply_rate}%`,
      hint: `Доля откликов за 90 дней, на которые компания ответила приглашением или отказом (${rating.applications} ${plural(rating.applications ?? 0, ["отклик", "отклика", "откликов"])}).`,
      trend: rating.reply_trend,
    },
    rating.reply_hours !== undefined && {
      icon: Timer, label: "Обычно отвечает", value: hoursLabel(rating.reply_hours),
      hint: "Медиана времени от отклика до ответа.",
    },
    rating.interview_rating !== undefined && {
      icon: Star, label: "Оценка собеседований", value: `${rating.interview_rating.toFixed(1).replace(".", ",")} из 5`,
      hint: `Средняя оценка кандидатов после собеседования (${rating.interview_ratings} ${plural(rating.interview_ratings ?? 0, ["оценка", "оценки", "оценок"])}).`,
    },
    rating.open_vacancies !== undefined && rating.open_vacancies > 0 && {
      icon: Ghost, label: "Вакансии-призраки",
      value: rating.reported_vacancies ? `${rating.reported_vacancies} из ${rating.open_vacancies}` : "нет",
      hint: "Открытые вакансии, о которых кандидаты сообщили «вакансия уже закрыта».",
    },
  ].filter(Boolean) as { icon: typeof Reply; label: string; value: string; hint: string; trend?: number }[];

  const reviews = rating.reviews ?? [];
  const dist = rating.distribution ?? [];
  const maxDist = Math.max(1, ...dist);

  return (
    <section aria-labelledby="rating-title" className="glass rounded-3xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-center gap-5">
        {rating.score !== undefined ? (
          <MatchRing value={rating.score} size={96} stroke={rating.score >= 70 ? "#5EEAD4" : "#818CF8"} />
        ) : (
          <div className="w-24 h-24 rounded-full border-[6px] border-white/10 flex items-center justify-center text-xs text-neutral-500 text-center px-2">мало данных</div>
        )}
        <div className="flex-1 min-w-[14rem] space-y-1">
          <h2 id="rating-title" className="font-display text-xl font-bold text-white">Рейтинг найма</h2>
          <p className="text-sm text-neutral-300">
            {rating.score !== undefined ? scoreLabel(rating.score)
              : "Итоговый балл появится, когда наберётся достаточно откликов и оценок кандидатов."}
          </p>
          {rating.verified && (
            <p className="text-xs text-teal-300 inline-flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Домен компании подтверждён</p>
          )}
        </div>
      </div>

      {signals.length > 0 && (
        <dl className="grid sm:grid-cols-2 gap-3">
          {signals.map(s => (
            <div key={s.label} className="rounded-2xl bg-white/[0.04] border border-white/[0.08] px-4 py-3" title={s.hint}>
              <dt className="text-xs text-neutral-500 inline-flex items-center gap-1.5"><s.icon className="w-3.5 h-3.5" aria-hidden="true" />{s.label}</dt>
              <dd className="mt-1 font-semibold text-white flex items-center gap-2">
                {s.value}
                {s.trend !== undefined && s.trend !== 0 && (
                  <span className={`text-xs font-normal inline-flex items-center gap-0.5 ${s.trend > 0 ? "text-emerald-300" : "text-amber-300"}`}>
                    {s.trend > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {s.trend > 0 ? "+" : ""}{s.trend} п. за месяц
                  </span>
                )}
              </dd>
              <p className="text-[11px] text-neutral-500 mt-1 leading-snug">{s.hint}</p>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-base font-semibold text-white inline-flex items-center gap-2">
            <MessageSquareQuote className="w-4 h-4 text-teal-300" aria-hidden="true" /> Отзывы о найме
          </h3>
          <p className="text-xs text-neutral-500">Только от кандидатов, которые откликались в {company} через FastCV</p>
        </div>

        {reviews.length === 0 ? (
          <p className="text-sm text-neutral-400">Отзывов пока нет. Их оставляют кандидаты после ответа компании на отклик.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="font-display text-3xl font-bold text-white">{rating.review_rating?.toFixed(1).replace(".", ",")}</p>
                <Stars value={rating.review_rating ?? 0} />
                <p className="text-xs text-neutral-500 mt-1">{rating.reviews_count} {plural(rating.reviews_count ?? 0, ["отзыв", "отзыва", "отзывов"])}</p>
              </div>
              {dist.length === 5 && (
                <div className="flex-1 min-w-[12rem] space-y-1" aria-label="Распределение оценок">
                  {[5, 4, 3, 2, 1].map(n => (
                    <div key={n} className="grid grid-cols-[1.5rem_1fr_2rem] items-center gap-2 text-xs text-neutral-400">
                      <span>{n}★</span>
                      <span className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                        <span className="block h-full bg-amber-300/80 rounded-full" style={{ width: `${(dist[n - 1] / maxDist) * 100}%` }} />
                      </span>
                      <span className="text-right tabular-nums">{dist[n - 1]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {rating.summary && (
              <div className="rounded-2xl bg-teal-300/[0.06] border border-teal-300/20 p-4">
                <p className="text-xs text-teal-300 inline-flex items-center gap-1.5 mb-1.5"><Sparkles className="w-3.5 h-3.5" /> Выжимка ИИ по отзывам</p>
                <p className="text-sm text-neutral-200 whitespace-pre-line leading-relaxed">{rating.summary}</p>
              </div>
            )}

            <ul className="space-y-3">
              {reviews.map(r => (
                <li key={r.id} className="rounded-2xl border border-white/10 p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Stars value={r.rating} size="w-3.5 h-3.5" />
                    <span className="text-xs text-neutral-400 inline-flex items-center gap-1">
                      {r.stage === "interview" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />}{stageLabel(r.stage)}
                    </span>
                    {r.who && <span className="text-xs text-neutral-500">{r.who}</span>}
                    <span className="text-xs text-neutral-600 ml-auto">{date(r.created_at)}</span>
                  </div>
                  {r.pros && <p className="text-sm text-neutral-200"><span className="text-emerald-300">Понравилось: </span>{r.pros}</p>}
                  {r.cons && <p className="text-sm text-neutral-200"><span className="text-amber-300">Не понравилось: </span>{r.cons}</p>}
                  {r.reply && (
                    <div className="ml-3 pl-3 border-l-2 border-indigo-400/40">
                      <p className="text-xs text-indigo-200">Ответ компании{r.replied_at ? ` · ${date(r.replied_at)}` : ""}</p>
                      <p className="text-sm text-neutral-300 whitespace-pre-line">{r.reply}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="text-[11px] text-neutral-500 leading-relaxed">
        Как считаем: доля ответов на отклики (30%), скорость ответа (15%), оценки собеседований (20%), отзывы о найме (25%) и
        отсутствие вакансий-призраков (10%). Учитываются только части, по которым достаточно данных; балл не зависит от оплаты.
      </p>
    </section>
  );
}
