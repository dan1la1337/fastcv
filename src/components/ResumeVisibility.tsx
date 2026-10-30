"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { saveErrorText } from "@/lib/auth-errors";
import { toast } from "@/components/Toaster";

/**
 * Кандидат открывает профиль в базе резюме для работодателей. По умолчанию закрыт:
 * показ — только с согласия. Контакты не показываются, работодатель пишет в чат.
 */
export default function ResumeVisibility({ userId }: { userId: string }) {
  const [state, setState] = useState<{ open: boolean; headline: string; publishedAt: string | null } | null>(null);
  const [headline, setHeadline] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("profiles").select("resume_public, resume_headline, resume_published_at").eq("id", userId).maybeSingle()
      .then(({ data }) => {
        setState({ open: Boolean(data?.resume_public), headline: data?.resume_headline ?? "", publishedAt: data?.resume_published_at ?? null });
        setHeadline(data?.resume_headline ?? "");
      });
  }, [userId]);

  async function save(open: boolean) {
    setBusy(true);
    const { data, error } = await supabase.from("profiles")
      .update({ resume_public: open, resume_headline: headline.trim() || null })
      .eq("id", userId).select("resume_public, resume_headline, resume_published_at").single();
    setBusy(false);
    if (error) return toast(saveErrorText(error.message), "error");
    setState({ open: data.resume_public, headline: data.resume_headline ?? "", publishedAt: data.resume_published_at });
    toast(open ? "Резюме открыто работодателям." : "Резюме скрыто из базы.", "ok");
  }

  if (!state) return null;
  return (
    <section aria-labelledby="resume-visibility" className="glass rounded-3xl p-6 sm:p-8 space-y-4">
      <div className="flex items-start gap-3">
        {state.open ? <Eye className="w-5 h-5 text-teal-300 mt-0.5" aria-hidden="true" /> : <EyeOff className="w-5 h-5 text-neutral-500 mt-0.5" aria-hidden="true" />}
        <div>
          <h2 id="resume-visibility" className="text-lg font-bold text-white">База резюме для работодателей</h2>
          <p className="text-sm text-neutral-400 mt-1 leading-relaxed">
            {state.open
              ? "Работодатели находят вас по навыкам, опыту и пожеланиям и пишут в чат FastCV. Почта и телефон им не видны."
              : "Сейчас резюме скрыто. Откройте его — и работодатели сами предложат вам вакансии."}
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="resume-headline" className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">
          Желаемая должность
        </label>
        <input id="resume-headline" maxLength={120} value={headline} onChange={e => setHeadline(e.target.value)}
          placeholder="Например: Python-разработчик (Middle)"
          className="w-full px-4 py-3 bg-[#0B0F19] border border-white/12 rounded-2xl text-sm text-neutral-100 focus:outline-none focus:border-teal-300 transition-colors" />
      </div>

      <p className="text-xs text-neutral-500">
        Работодатели увидят: имя, должность, навыки, опыт, уровень, направления, формат, город, желаемую зарплату,
        текст «Опыт работы и о себе» и PDF-резюме, если оно загружено. Всё это — из{" "}
        <Link href="#top" className="text-teal-300 hover:underline">формы профиля выше</Link>.
      </p>

      <div className="flex flex-wrap gap-2">
        {state.open ? (
          <>
            <button type="button" onClick={() => save(true)} disabled={busy || headline.trim() === state.headline}
              className="px-5 h-11 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold disabled:opacity-50 transition-colors">
              Сохранить должность
            </button>
            <button type="button" onClick={() => save(false)} disabled={busy}
              className="px-5 h-11 rounded-full border border-white/15 text-sm text-neutral-300 hover:text-white hover:border-white/30 disabled:opacity-50 transition-colors inline-flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Скрыть резюме
            </button>
          </>
        ) : (
          <button type="button" onClick={() => save(true)} disabled={busy}
            className="px-5 h-11 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold disabled:opacity-50 transition-colors inline-flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Открыть резюме работодателям
          </button>
        )}
      </div>
      {state.open && state.publishedAt && (
        <p className="text-xs text-neutral-500">
          Обновлено {new Date(state.publishedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} —
          свежие резюме работодатели видят первыми; дата обновляется, когда вы правите профиль.
        </p>
      )}
    </section>
  );
}
