import Link from "next/link";
import { Clock, MapPin, Sparkles, ExternalLink, Globe, Briefcase, Building2, Bookmark, BookmarkCheck, EyeOff, Ghost } from "lucide-react";
import { experienceLabel, formatLabel, formatSalary, freshnessLabel, ghostSignal, levelLabel, sourceOf, type Vacancy } from "@/lib/vacancies";
import { estimateSalary, type SalaryBenchmark } from "@/lib/salary";
import type { MarkKind } from "@/lib/marks";
import type { Match } from "@/lib/matching";
import CompanyLine from "@/components/CompanyLine";
import MatchRing from "@/components/MatchRing";
import SalaryEstimate from "@/components/SalaryEstimate";

/** Карточка вакансии в ленте. */
export default function VacancyCard({
  item, match, benchmarks, isCandidate, savedMode, mark, pending, addingSkill, onApply, onAddSkill, onToggleMark,
}: {
  item: Vacancy;
  /** Совпадение с профилем; без заполненного профиля не передаём. */
  match: Match | undefined;
  benchmarks: SalaryBenchmark[];
  isCandidate: boolean;
  savedMode: boolean;
  mark: MarkKind | undefined;
  /** Отметка этой вакансии ещё сохраняется. */
  pending: boolean;
  addingSkill: string | null;
  onApply: (item: Vacancy) => void;
  onAddSkill: (skill: string) => void;
  onToggleMark: (item: Vacancy, kind: MarkKind) => void;
}) {
  return (
    <div className="neu-sub card-hover rounded-3xl p-4 sm:p-6 flex flex-col gap-4 relative overflow-hidden group">

      {/* Метки над заголовком отдельной строкой: поверх длинного названия они его перекрывали.
          На телефоне совпадение тоже здесь: кольцо сжало бы заголовок */}
      <div className="flex flex-wrap items-center gap-2">
        {match && (
          <span className={`sm:hidden neu-chip text-xs px-2 py-0.5 tabular-nums ${match.score >= 70 ? "!text-teal-200 !border-teal-300/40" : "!text-amber-300 !border-amber-300/40"}`}>
            {match.score}%
          </span>
        )}
        {item.source_type === 'external' ? (
          <span className="neu-chip text-xs px-2 py-0.5">{sourceOf(item).badge}</span>
        ) : (
          <span className="neu-chip text-xs px-2 py-0.5 inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
            Прямой работодатель
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex gap-4 sm:gap-5 items-start min-w-0">
        {match && <span className="hidden sm:block shrink-0"><MatchRing value={match.score} size={64} stroke={match.score >= 70 ? "#5eead4" : "#fcd34d"} /></span>}
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-semibold text-neutral-100 leading-snug">
            <Link href={`/vacancy/${item.id}`} className="hover:text-teal-300 transition-colors">{item.title}</Link>
          </h2>
          <CompanyLine vacancy={item} className="text-sm text-neutral-400 mt-0.5" />
          <p className="text-base font-semibold text-neutral-100 mt-1.5 flex flex-wrap items-center gap-2">
            {formatSalary(item.salary_min, item.salary_max, item.salary_currency)}
            {(() => {
              const estimate = estimateSalary(item, benchmarks);
              return estimate && <SalaryEstimate estimate={estimate} className="text-xs" />;
            })()}
          </p>
          <p className="flex flex-wrap items-center gap-3 text-xs text-neutral-400 mt-2">
            {(item.level || item.experience_min != null) && (
            <span className="inline-flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" />
              {[item.level && levelLabel(item.level), experienceLabel(item.experience_min)].filter(Boolean).join(" · ")}
            </span>
          )}
            {(item.city || item.country) && (
              <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />
                {/* Зарубежный город — со страной: «Белград, Сербия» */}
                {[item.city, item.country !== "Россия" || !item.city ? item.country : null].filter(Boolean).join(", ")}
              </span>
            )}
            {item.work_format === "remote" || (!item.work_format && item.is_remote)
              ? <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5" />Удалённо</span>
              : item.work_format && <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{formatLabel(item.work_format)}</span>}
            <span className="inline-flex items-center gap-1" title="Когда вакансию впервые опубликовали и во скольких каналах" suppressHydrationWarning>
              <Clock className="w-3.5 h-3.5" />{freshnessLabel(item)}
            </span>
            {ghostSignal(item) && (
              <span className="inline-flex items-center gap-1 text-amber-300" title={ghostSignal(item)!}>
                <Ghost className="w-3.5 h-3.5" aria-hidden="true" />Возможно, неактуальна
              </span>
            )}
          </p>
        </div>
        </div>

        <button
          onClick={() => onApply(item)}
          className="lg lg-tint inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-colors shrink-0 relative z-10 sm:self-end"
        >
          <Sparkles className="w-4 h-4" /> Откликнуться с ИИ
        </button>
      </div>
      <p className="text-sm text-neutral-400 leading-relaxed line-clamp-2 sm:line-clamp-3">{item.description}</p>

      {match?.core && match.core.fit !== "match" && match.core.stack.length > 0 && (
        <p className={`text-xs ${match.core.fit === "foreign" ? "text-amber-300" : "text-neutral-400"}`}>
          Основной стек вакансии: <span className="font-medium">{match.core.stack.join(", ")}</span>
          {match.core.fit === "foreign" && " — не ваш, поэтому совпадение не выше 40%"}
          {match.core.fit === "related" && " — смежный с вашим"}
          {match.core.fit === "unknown" && " — укажите в профиле свой основной стек, чтобы совпадение было точнее"}
        </p>
      )}

      {match && (match.matched.length > 0 || match.missing.length > 0 || match.related.length > 0) && (
        <p className="text-xs text-neutral-500">
          {match.matched.length > 0 && <>Есть у вас: <span className="text-teal-200">{match.matched.join(", ")}</span></>}
          {match.related.length > 0 && (
            <>
              {match.matched.length > 0 && " · "}
              Близко:{" "}
              <span className="text-sky-300" title="Засчитано наполовину: у вас есть смежный опыт">
                {match.related.map(r => `${r.skill} (у вас ${r.via})`).join(", ")}
              </span>
            </>
          )}
          {(match.matched.length > 0 || match.related.length > 0) && match.missing.length > 0 && " · "}
          {match.missing.length > 0 && (
            <>
              Не хватает:{" "}
              {match.missing.map((skill, i) => (
                <span key={skill}>
                  {i > 0 && ", "}
                  <button
                    onClick={() => onAddSkill(skill)}
                    disabled={addingSkill !== null}
                    title="У меня есть этот опыт — добавить в профиль"
                    aria-label={`+ ${skill} в профиль: у меня есть этот опыт`}
                    className="text-amber-300 underline decoration-dotted underline-offset-2 hover:text-amber-200 disabled:opacity-60"
                  >
                    {addingSkill === skill ? "добавляем…" : `+ ${skill} в профиль`}
                  </button>
                </span>
              ))}
              <span className="hidden sm:inline text-neutral-600"> — нажмите на навык, если он у вас есть</span>
            </>
          )}
        </p>
      )}

      {(item.stack?.length || item.source_url || isCandidate) ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* С совпадением навыки уже названы строкой «Есть у вас / Не хватает»: второй раз не повторяем */}
          {!match && item.stack?.slice(0, 8).map(tech => (
            <span key={tech} className="text-xs px-2 py-0.5 neu-chip">
              {tech}
            </span>
          ))}
          <span className="ml-auto inline-flex items-center gap-3">
            {isCandidate && (
              <>
                <button
                  onClick={() => onToggleMark(item, "saved")}
                  disabled={pending}
                  aria-pressed={mark === "saved"}
                  className={`inline-flex items-center gap-1 text-xs transition-colors ${mark === "saved" ? "text-amber-300" : "text-neutral-500 hover:text-amber-300"}`}
                >
                  {mark === "saved" ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
                  {mark === "saved" ? "В избранном" : "В избранное"}
                </button>
                {!savedMode && (
                  <button
                    onClick={() => onToggleMark(item, "hidden")}
                    disabled={pending}
                    className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    <EyeOff className="w-3.5 h-3.5" /> Скрыть
                  </button>
                )}
              </>
            )}
            {item.source_url && (
              <a
                href={item.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-teal-300 transition-colors"
              >
                {sourceOf(item).link} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}
