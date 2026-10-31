"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, Sparkles, CalendarCheck, ExternalLink, Loader2, MessageCircle, MessageSquare } from "lucide-react";
import { supabase, getUserRole } from "@/lib/supabase";
import { plural } from "@/lib/vacancies";
import HiringReviewForm, { type MyReview } from "@/components/HiringReviewForm";
import type { Upcoming } from "@/components/UpcomingInterviews";
import { slotLabel, slotRange } from "@/lib/interviews";
import { funnelView, type FunnelView } from "@/lib/funnel";
import RejectionAnalysis from "@/components/RejectionAnalysis";
import type { RejectionAnalysis as Analysis } from "@/lib/rejection";
import InterviewStars from "@/components/InterviewStars";

interface Application {
  id: string;
  status: string;
  cover_letter: string | null;
  hr_message: string | null;
  created_at: string;
  /** Когда работодатель впервые открыл отклик (ставит база). */
  viewed_at: string | null;
  answered_at: string | null;
  /** Можно оставить отзыв о найме: работодатель ответил или прошло 10 дней */
  reviewable?: boolean;
  /** Где отклик в воронке работодателя (пока ждёт ответа) */
  funnel?: FunnelView;
  vacancies: { id: string; title: string; company_name: string | null; source_type: string; source_url: string | null } | null;
  /** Чат с работодателем — есть у откликов на вакансии работодателей с FastCV */
  conversations: { id: string } | null;
}

const STATUS: Record<string, { text: string; style: string }> = {
  new: { text: "Ждёт ответа работодателя", style: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  viewed: { text: "Просмотрен", style: "bg-teal-300/10 text-teal-300 border-teal-300/20" },
  interview_scheduled: { text: "Приглашение на собеседование", style: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  rejected: { text: "Отказ", style: "bg-white/[0.08] text-neutral-400 border-white/15" },
};

export default function CandidateApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  /** Оценки собеседований по откликам (рейтинг найма) */
  const [ratings, setRatings] = useState<Record<string, number>>({});
  /** Отзывы о процессе найма (рейтинг работодателя) */
  const [reviews, setReviews] = useState<Record<string, MyReview>>({});
  /** Сохранённые разборы отказов */
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  /** Назначенные собеседования по откликам */
  const [interviews, setInterviews] = useState<Record<string, Upcoming>>({});
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      // У работодателя свой раздел с откликами
      if ((await getUserRole(user)) === "employer") {
        router.replace("/employer");
        return;
      }

      const { data } = await supabase
        .from("applications")
        .select("id, status, hr_message, cover_letter, created_at, viewed_at, answered_at, vacancies (id, title, company_name, source_type, source_url), conversations (id)")
        .eq("candidate_id", user.id)
        .order("created_at", { ascending: false });

      const [{ data: rated }, { data: mine }, { data: upcoming }, { data: funnel }, { data: rejected }] = await Promise.all([
        supabase.rpc("my_interview_ratings"),
        supabase.rpc("my_hiring_reviews"),
        supabase.rpc("my_upcoming_interviews"),
        supabase.rpc("my_application_funnel"),
        supabase.from("rejection_analyses").select("application_id, analysis"),
      ]);
      setAnalyses(Object.fromEntries((rejected ?? []).map(r => [r.application_id, r.analysis as unknown as Analysis])));
      const funnels = new Map((funnel ?? []).map(f => [f.application_id, f]));
      if (cancelled) return;
      setInterviews(Object.fromEntries((upcoming ?? []).filter(u => u.application_id).map(u => [u.application_id!, u as Upcoming])));
      setReviews(Object.fromEntries((mine ?? []).map(r => [r.application_id, r as MyReview])));
      setRatings(Object.fromEntries((rated ?? []).map(r => [r.application_id, r.rating])));
      const now = Date.now();
      const cutoff = now - 10 * 864e5;
      setApplications(((data ?? []) as unknown as Application[])
        .map(a => {
          const f = funnels.get(a.id);
          const waiting = a.status === "new" || a.status === "viewed";
          return {
            ...a,
            reviewable: !!a.answered_at || new Date(a.created_at).getTime() < cutoff,
            funnel: f && waiting ? funnelView(f, a.created_at, now) : undefined,
          };
        }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function rate(id: string, rating: number) {
    const before = ratings[id];
    setRatings(r => ({ ...r, [id]: rating }));
    const { data, error } = await supabase.rpc("rate_my_interview", { application: id, rating });
    if (error || !data) setRatings(r => ({ ...r, [id]: before }));
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-teal-300" />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-neutral-100 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="К вакансиям" className="p-2 bg-neutral-900 border border-white/10 rounded-xl hover:bg-white/[0.08] transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="font-display text-xl font-bold">Мои отклики</h1>
          </div>
          <span className="text-xs text-neutral-400 bg-neutral-900 px-3 py-1.5 rounded-full border border-white/10 whitespace-nowrap">
            {applications.length} {plural(applications.length, ["отклик", "отклика", "откликов"])}
          </span>
        </div>

        {applications.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-white/15 rounded-3xl space-y-3">
            <MessageSquare className="w-10 h-10 mx-auto text-neutral-700" />
            <p className="text-neutral-400 text-sm font-medium">Вы ещё не откликались на вакансии</p>
            <Link href="/" className="inline-block text-sm text-teal-300 hover:text-teal-200">Перейти к вакансиям</Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {applications.map((app) => {
              const v = app.vacancies;
              const external = v?.source_type === "external";
              // Отклик на вакансию из Telegram уходит работодателю в Telegram или на почту:
              // ответ придёт туда, а статус здесь работодатель не меняет
              const status = external
                ? { text: "Отправлен в Telegram / на почту", style: "bg-white/[0.08] text-neutral-300 border-white/15" }
                : STATUS[app.status] ?? STATUS.new;
              return (
                <div key={app.id} className="glass rounded-3xl p-5 sm:p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="min-w-0">
                      {v ? (
                        <Link href={`/vacancy/${v.id}`} className="text-lg font-bold text-white hover:text-teal-300 transition-colors">
                          {v.title}
                        </Link>
                      ) : (
                        <span className="text-lg font-bold text-neutral-400">Вакансия удалена</span>
                      )}
                      <p className="text-xs text-neutral-500 mt-1">
                        {v?.company_name ? `${v.company_name} · ` : ""}
                        {new Date(app.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                      </p>
                    </div>
                    <div className="flex flex-col sm:items-end gap-1 shrink-0">
                      <span className={`text-xs px-3 py-1 rounded-full font-medium border w-fit ${status.style}`}>
                        {status.text}
                      </span>
                      {app.viewed_at && (
                        <span className="text-[11px] text-neutral-500">
                          Открыт работодателем {new Date(app.viewed_at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                  </div>

                  {app.hr_message && (
                    <div className={`rounded-xl border p-4 text-sm leading-relaxed ${
                      app.status === "interview_scheduled" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100" : "border-white/10 bg-neutral-950 text-neutral-300"
                    }`}>
                      <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Ответ работодателя</p>
                      <p className="whitespace-pre-line">{app.hr_message}</p>
                    </div>
                  )}

                  {app.funnel && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 space-y-1.5 text-sm" aria-label="Где ваш отклик">
                      <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider inline-flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" /> Где ваш отклик
                      </p>
                      <p className="text-neutral-200">{app.funnel.queue}</p>
                      {app.funnel.match && <p className="text-neutral-300">{app.funnel.match}</p>}
                      <p className="text-neutral-300">{app.funnel.activity}</p>
                      {app.funnel.reply && <p className="text-neutral-300">{app.funnel.reply}</p>}
                      {app.funnel.weak && (
                        <p className="text-xs text-amber-200">
                          Совпадение ниже, чем у большинства. Добавьте в <Link href="/profile" className="underline hover:text-white">профиль</Link> навыки
                          и опыт, которые есть у вас и упомянуты в вакансии, — оценка пересчитается сразу.
                        </p>
                      )}
                    </div>
                  )}

                  {interviews[app.id] && (
                    <Link href={`/messages?c=${interviews[app.id].conversation_id}`}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.07] px-4 py-3 text-sm text-white hover:border-emerald-300/60">
                      <CalendarCheck className="w-4 h-4 text-emerald-300" aria-hidden="true" />
                      Собеседование: <b>{slotLabel(interviews[app.id].starts_at)}</b>
                      <span className="text-neutral-400">({slotRange(interviews[app.id].starts_at, interviews[app.id].duration_min)})</span>
                    </Link>
                  )}

                  {app.status === "interview_scheduled" && v?.id && (
                    <Link href={`/practice/${v.id}`}
                      className="inline-flex items-center gap-1.5 text-sm text-teal-300 hover:text-teal-200 transition-colors">
                      <Sparkles className="w-4 h-4" /> Подготовиться к собеседованию с ИИ
                    </Link>
                  )}

                  {!external && app.status === "interview_scheduled" && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 px-4 py-3">
                      <p className="text-sm text-neutral-300">
                        {ratings[app.id] ? "Ваша оценка собеседования" : "Как прошло собеседование?"}
                        <span className="block text-xs text-neutral-500">Анонимно: работодатель видит только среднюю оценку</span>
                      </p>
                      <InterviewStars value={ratings[app.id] ?? null} onRate={n => rate(app.id, n)} />
                    </div>
                  )}

                  {!external && app.reviewable && (
                    <HiringReviewForm applicationId={app.id} company={v?.company_name ?? null} review={reviews[app.id] ?? null}
                      onSaved={r => setReviews(all => ({ ...all, [app.id]: r }))} />
                  )}

                  {!external && app.status === "rejected" && (
                    <RejectionAnalysis applicationId={app.id} vacancyId={v?.id ?? null} initial={analyses[app.id] ?? null} />
                  )}

                  {app.cover_letter && (
                    <details className="bg-[#0B0F19] border border-white/12 rounded-2xl p-4 text-sm text-neutral-300 group">
                      <summary className="cursor-pointer text-xs font-bold text-neutral-500 uppercase tracking-wider select-none">
                        Сопроводительное письмо
                      </summary>
                      <p className="mt-3 whitespace-pre-line leading-relaxed">{app.cover_letter}</p>
                    </details>
                  )}

                  {app.conversations?.id && (
                    <Link href={`/messages?c=${app.conversations.id}`}
                      className="inline-flex items-center gap-1.5 text-sm text-teal-300 hover:text-teal-200 transition-colors">
                      <MessageCircle className="w-4 h-4" /> Чат с работодателем
                    </Link>
                  )}

                  {external && v?.source_url && (
                    <a href={v.source_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-teal-300 transition-colors">
                      Оригинальный пост <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
