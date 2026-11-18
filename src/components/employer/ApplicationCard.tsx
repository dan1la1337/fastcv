import Link from "next/link";
import { CheckCircle2, ChevronDown, FileText, Loader2, MessageCircle, Send, XCircle } from "lucide-react";
import MatchRing from "@/components/MatchRing";
import BlitzAnswers from "@/components/BlitzAnswers";
import ScreeningVerdict from "@/components/ScreeningVerdict";
import { REJECT_REASONS, REPLY_TEMPLATES, STATUS_LABELS, type Application, type ReplyStatus } from "@/lib/employer";
import type { Match } from "@/lib/matching";
import type { Screening } from "@/lib/screening";
import { inputClass } from "@/components/employer/styles";

export interface Reply { appId: string; status: ReplyStatus; text: string }

/** Отклик в кабинете: кандидат, совпадение, ответ кандидату, вердикт ИИ, блиц и письмо. */
export default function ApplicationCard({
  app, match, screening, selected, onToggleSelected, reply, setReply, replying, onSendReply, onOpenResume, onScreeningChange,
}: {
  app: Application;
  match: Match | undefined;
  screening: Screening | undefined;
  /** Отклик выбран для массового отказа. */
  selected: boolean;
  onToggleSelected: (id: string) => void;
  /** Ответ, который сейчас пишут (любому отклику). */
  reply: Reply | null;
  setReply: (reply: Reply | null) => void;
  replying: boolean;
  onSendReply: () => void;
  onOpenResume: (path: string) => void;
  onScreeningChange: (id: string, screening: Screening) => void;
}) {
  return (
    <div className={`glass rounded-3xl p-5 sm:p-6 space-y-4 ${selected ? "ring-1 ring-teal-300/50" : ""}`}>
      <div className="flex flex-wrap items-center gap-4">
        {(app.status === "new" || app.status === "viewed") && (
          <input type="checkbox" checked={selected} onChange={() => onToggleSelected(app.id)}
            aria-label={`Выбрать отклик: ${app.profiles?.name || "без имени"}`}
            className="w-5 h-5 accent-teal-300 cursor-pointer" />
        )}
        {match && (
          <MatchRing value={match.score} size={64} stroke={match.score >= 70 ? "#5eead4" : "#fcd34d"} />
        )}
        <div className="flex-1 min-w-[14rem]">
          <p className="text-lg font-semibold text-white flex flex-wrap items-center gap-2">
            {app.profiles?.name || "Без имени"}
            <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
              app.status === "interview_scheduled" ? "bg-teal-300/15 text-teal-200"
                : app.status === "rejected" ? "bg-white/[0.08] text-neutral-400"
                : "bg-white/[0.08] text-neutral-200"
            }`}>
              {STATUS_LABELS[app.status] ?? app.status}
            </span>
          </p>
          <p className="text-sm text-neutral-200 mt-1">{app.vacancies.title}</p>
          {app.profiles?.skills?.length ? <p className="text-xs text-neutral-500 mt-0.5">{app.profiles.skills.slice(0, 6).join(", ")}</p> : null}
        </div>
      </div>

      {match && (match.matched.length + match.related.length + match.missing.length > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {match.matched.map(s => <span key={s} className="neu-chip px-2 py-1 text-xs !text-teal-200 !border-teal-300/40">{s} ✓</span>)}
          {match.related.map(r => (
            <span key={r.skill} title="Засчитано наполовину: у кандидата смежный опыт" className="px-2.5 py-1 rounded-full bg-sky-400/10 text-sky-200">{r.skill} ≈ {r.via}</span>
          ))}
          {match.missing.map(s => <span key={s} className="neu-chip px-2 py-1 text-xs !text-amber-300 !border-amber-300/40">нет {s}</span>)}
        </div>
      )}

      {app.hr_message && reply?.appId !== app.id && (
        <div className="neu-sub rounded-2xl px-4 py-3 text-sm text-neutral-400">
          <p className="text-xs text-neutral-500 mb-1">Ваш ответ</p>
          <p className="whitespace-pre-line">{app.hr_message}</p>
        </div>
      )}

      {reply?.appId === app.id && (
        <div className="space-y-3 rounded-2xl border border-teal-300/30 bg-teal-300/[0.06] p-4">
          <p className="text-xs text-neutral-300">
            {reply.status === "interview_scheduled" ? "Приглашение на собеседование" : "Отказ"} — кандидат увидит этот текст
          </p>
          {reply.status === "rejected" && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Причина отказа">
              {REJECT_REASONS.map(reason => {
                const base = REPLY_TEMPLATES.rejected(app.vacancies.title);
                const active = reply.text === `${base}\n\n${reason.text}`;
                return (
                  <button key={reason.label} type="button" aria-pressed={active}
                    onClick={() => setReply({ ...reply, text: active ? base : `${base}\n\n${reason.text}` })}
                    className={`lg px-3 py-1 rounded-full text-xs transition-colors ${active ? "lg lg-on" : "lg text-neutral-300"}`}>
                    {reason.label}
                  </button>
                );
              })}
            </div>
          )}
          <textarea value={reply.text} maxLength={2000} rows={6} aria-label="Текст ответа кандидату"
            onChange={e => setReply({ ...reply, text: e.target.value })}
            className={`${inputClass} leading-relaxed resize-y max-h-52`} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setReply(null)} className="lg h-11 px-4 rounded-full text-sm text-neutral-200 transition-colors">Отмена</button>
            <button onClick={onSendReply} disabled={replying}
              className="lg lg-accent h-11 px-5 rounded-full text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {replying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Отправить
            </button>
          </div>
        </div>
      )}

      {/* Пока пишем ответ, кнопки решения убраны: иначе рядом два разных «отправить» */}
      {reply?.appId !== app.id && (
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end gap-2.5">
        {app.profiles?.has_resume && (
          <button onClick={() => onOpenResume(`${app.candidate_id}/resume.pdf`)}
            className="lg col-span-2 sm:mr-auto h-11 px-4 rounded-full text-neutral-200 text-sm transition-colors flex items-center justify-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Резюме (PDF)
          </button>
        )}
        {app.conversations?.id && (
          <Link href={`/messages?c=${app.conversations.id}`}
            className={`${app.profiles?.has_resume ? "" : "sm:mr-auto "}lg h-11 px-4 rounded-full text-neutral-200 text-sm transition-colors flex items-center justify-center gap-1.5`}>
            <MessageCircle className="w-3.5 h-3.5" /> Написать
          </Link>
        )}
        <button onClick={() => setReply({ appId: app.id, status: "rejected", text: REPLY_TEMPLATES.rejected(app.vacancies.title) })}
          className="lg h-11 px-4 rounded-full text-neutral-300 hover:text-red-300 text-sm transition-colors flex items-center justify-center gap-1.5">
          <XCircle className="w-3.5 h-3.5" /> Отказать
        </button>
        <button onClick={() => setReply({ appId: app.id, status: "interview_scheduled", text: REPLY_TEMPLATES.interview_scheduled(app.vacancies.title) })}
          className="lg lg-accent col-span-2 order-first sm:order-none h-12 sm:h-11 px-5 rounded-full text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> Пригласить
        </button>
      </div>
      )}

      {/* Решение выше подробностей: кнопки видно, не пролистывая ответы и письмо */}
      <ScreeningVerdict applicationId={app.id} screening={screening}
        onChange={sc => onScreeningChange(app.id, sc)} />

      <BlitzAnswers applicationId={app.id} answers={app.blitz_answers ?? []} summary={app.blitz_summary} />

      {/* Письмо свёрнуто до двух строк: иначе на экран помещается одна карточка, а кнопки решения уходят вниз */}
      <details className="group border-t border-white/10 pt-3 text-sm text-neutral-300 leading-relaxed">
        <summary className="cursor-pointer list-none">
          <span className="flex items-center justify-between gap-2 text-xs text-neutral-500">
            Сопроводительное письмо
            <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </span>
          <span className="mt-1.5 line-clamp-2 group-open:hidden">{app.cover_letter || "Письмо не сохранено"}</span>
        </summary>
        <p className="mt-1.5 whitespace-pre-line">{app.cover_letter || "Письмо не сохранено"}</p>
      </details>
    </div>
  );
}
