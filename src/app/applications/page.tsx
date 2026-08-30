"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, MessageSquare, Clock, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";

export default function CandidateApplications() {
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchMyApplications();
  }, []);

  async function fetchMyApplications() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const { data } = await supabase
      .from("applications")
      .select(`
        id,
        status,
        cover_letter,
        created_at,
        vacancies (
          id,
          title,
          source_type
        )
      `)
      .eq("candidate_id", user.id)
      .order("created_at", { ascending: false });

    if (data) setApplications(data);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 bg-neutral-900 border border-neutral-800 rounded-xl hover:bg-neutral-800 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-xl font-bold">Мои отклики и чаты</h1>
          </div>
          <span className="text-xs text-neutral-400 bg-neutral-900 px-3 py-1.5 rounded-full border border-neutral-800">
            Всего: {applications.length}
          </span>
        </div>

        {applications.length === 0 ? (
          <div className="text-center py-20 bg-neutral-900/30 border border-dashed border-neutral-800 rounded-2xl">
            <MessageSquare className="w-10 h-10 mx-auto text-neutral-700 mb-3" />
            <p className="text-neutral-400 text-sm font-medium">У вас пока нет активных откликов</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {applications.map((app) => (
              <div key={app.id} className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row justify-between gap-2">
                  <h3 className="text-lg font-bold text-white">{app.vacancies?.title || "Вакансия"}</h3>
                  
                  <span className={`text-xs px-3 py-1 rounded-full font-medium border w-fit ${
                    app.status === 'new' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                    app.status === 'interview_scheduled' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                    'bg-neutral-800 text-neutral-400 border-neutral-700'
                  }`}>
                    {app.status === 'new' ? 'На рассмотрении у работодателя' :
                     app.status === 'interview_scheduled' ? 'Собеседование назначено' : 'Отказ'}
                  </span>
                </div>

                <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 text-sm text-neutral-300">
                  <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Отправленное письмо:</p>
                  <p className="line-clamp-3">{app.cover_letter}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}