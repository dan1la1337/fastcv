"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, MessageSquare } from "lucide-react";
import { supabase, getUserRole } from "@/lib/supabase";
import { plural } from "@/lib/vacancies";

interface Application {
  id: string;
  status: string;
  cover_letter: string | null;
  created_at: string;
  vacancies: { id: string; title: string; company_name: string | null; source_type: string; source_url: string | null } | null;
}

const STATUS: Record<string, { text: string; style: string }> = {
  new: { text: "Ждёт ответа работодателя", style: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  viewed: { text: "Просмотрен", style: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  interview_scheduled: { text: "Приглашение на собеседование", style: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  rejected: { text: "Отказ", style: "bg-neutral-800 text-neutral-400 border-neutral-700" },
};

export default function CandidateApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
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
        .select("id, status, cover_letter, created_at, vacancies (id, title, company_name, source_type, source_url)")
        .eq("candidate_id", user.id)
        .order("created_at", { ascending: false });

      if (cancelled) return;
      setApplications((data ?? []) as unknown as Application[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="К вакансиям" className="p-2 bg-neutral-900 border border-neutral-800 rounded-xl hover:bg-neutral-800 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-xl font-bold">Мои отклики</h1>
          </div>
          <span className="text-xs text-neutral-400 bg-neutral-900 px-3 py-1.5 rounded-full border border-neutral-800 whitespace-nowrap">
            {applications.length} {plural(applications.length, ["отклик", "отклика", "откликов"])}
          </span>
        </div>

        {applications.length === 0 ? (
          <div className="text-center py-20 bg-neutral-900/30 border border-dashed border-neutral-800 rounded-2xl space-y-3">
            <MessageSquare className="w-10 h-10 mx-auto text-neutral-700" />
            <p className="text-neutral-400 text-sm font-medium">Вы ещё не откликались на вакансии</p>
            <Link href="/" className="inline-block text-sm text-blue-400 hover:text-blue-300">Перейти к вакансиям</Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {applications.map((app) => {
              const v = app.vacancies;
              const external = v?.source_type === "external";
              // Отклик на вакансию из Telegram уходит работодателю в Telegram или на почту:
              // ответ придёт туда, а статус здесь работодатель не меняет
              const status = external
                ? { text: "Отправлен в Telegram / на почту", style: "bg-neutral-800 text-neutral-300 border-neutral-700" }
                : STATUS[app.status] ?? STATUS.new;
              return (
                <div key={app.id} className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="min-w-0">
                      {v ? (
                        <Link href={`/vacancy/${v.id}`} className="text-lg font-bold text-white hover:text-blue-400 transition-colors">
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
                    <span className={`text-xs px-3 py-1 rounded-full font-medium border w-fit shrink-0 ${status.style}`}>
                      {status.text}
                    </span>
                  </div>

                  {app.cover_letter && (
                    <details className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-sm text-neutral-300 group">
                      <summary className="cursor-pointer text-xs font-bold text-neutral-500 uppercase tracking-wider select-none">
                        Сопроводительное письмо
                      </summary>
                      <p className="mt-3 whitespace-pre-line leading-relaxed">{app.cover_letter}</p>
                    </details>
                  )}

                  {external && v?.source_url && (
                    <a href={v.source_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-blue-400 transition-colors">
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
