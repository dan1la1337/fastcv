"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchMatches, type Match } from "@/lib/matching";
import MatchRing from "@/components/MatchRing";
import { toast } from "@/components/Toaster";

/**
 * Совпадение вакансии с профилем кандидата: кольцо, навыки, которые есть, и недостающие —
 * их можно добавить в профиль одним нажатием. Гостям и работодателям не показывается.
 */
export default function VacancyMatch({ vacancyId }: { vacancyId: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [match, setMatch] = useState<Match | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role, skills").eq("id", user.id).maybeSingle();
      if (!profile || profile.role !== "candidate") return;
      const found = await fetchMatches([vacancyId]).catch(() => ({} as Record<string, Match>));
      if (cancelled) return;
      setUserId(user.id);
      setSkills((profile.skills as string[] | null) ?? []);
      setMatch(found[vacancyId] ?? null);
    })();
    return () => { cancelled = true; };
  }, [vacancyId]);

  async function addSkill(skill: string) {
    if (!userId || adding) return;
    const next = [...new Set([...skills, skill])].slice(0, 50);
    setAdding(skill);
    const { error } = await supabase.from("profiles").update({ skills: next }).eq("id", userId);
    setAdding(null);
    if (error) {
      toast("Не удалось обновить профиль. Попробуйте ещё раз.", "error");
      return;
    }
    setSkills(next);
    const found = await fetchMatches([vacancyId]).catch(() => null);
    if (found?.[vacancyId]) setMatch(found[vacancyId]);
    toast(`«${skill}» добавлен в профиль — совпадение пересчитано.`, "ok");
  }

  if (!match) return null;
  const total = match.matched.length + match.related.length + match.missing.length;
  return (
    <section aria-label="Совпадение с профилем" className="glass rounded-3xl p-6 flex flex-wrap items-center gap-6">
      <MatchRing value={match.score} size={140} stroke={match.score >= 70 ? "#5EEAD4" : "#818CF8"} />
      <div className="flex-1 min-w-[16rem] space-y-3">
        <p className="text-neutral-300">
          {total > 0
            ? `Совпадает ${match.matched.length} из ${total} навыков вакансии${match.related.length ? `, ещё ${match.related.length} — по смежному опыту` : ""}.`
            : "Совпадение посчитано по уровню, формату и городу."}
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          {match.matched.map(s => (
            <span key={s} className="px-3 py-1.5 rounded-full bg-teal-300/15 text-teal-200">{s} ✓</span>
          ))}
          {match.related.map(r => (
            <span key={r.skill} title="Засчитано наполовину: у вас есть смежный опыт" className="px-3 py-1.5 rounded-full bg-sky-400/10 text-sky-200">
              {r.skill} ≈ {r.via}
            </span>
          ))}
          {match.missing.map(s => (
            <button key={s} onClick={() => addSkill(s)} disabled={adding !== null}
              aria-label={`У меня есть опыт с ${s} — добавить в профиль`}
              className="px-3 py-1.5 rounded-full border border-dashed border-amber-300/70 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20 disabled:opacity-60 transition-colors">
              {adding === s ? "добавляем…" : `+ ${s} в профиль`}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
