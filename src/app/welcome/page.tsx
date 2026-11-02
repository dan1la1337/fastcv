"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import Logo from "@/components/Logo";
import { saveErrorText } from "@/lib/auth-errors";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/Toaster";
import { AREAS, DIRECTIONS, WORK_FORMATS, levelApplies, parseExperience, plural, type Area, type Level, type WorkFormat } from "@/lib/vacancies";
import LevelPicker from "@/components/LevelPicker";
import ExperienceInput from "@/components/ExperienceInput";

const MAX_DIRECTIONS = 5;

const inputClass =
  "w-full neu-in rounded-2xl px-4 py-3 text-sm text-neutral-200 transition-colors";
const labelClass = "block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2";
const chip = (active: boolean) =>
  `text-sm px-3.5 py-1.5 rounded-full transition-colors ${active
    ? "lg lg-accent"
    : "lg text-neutral-300 hover:text-neutral-100"}`;

/**
 * Онбординг кандидата за минуту: сразу после регистрации спрашиваем, что он ищет,
 * и ведём в персональную подборку «Для вас». Всё можно поменять позже в профиле.
 */
export default function WelcomePage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [directions, setDirections] = useState<string[]>([]);
  const [level, setLevel] = useState<Level | "">("");
  const [experience, setExperience] = useState("");
  const [leadsPeople, setLeadsPeople] = useState(false);
  const [formats, setFormats] = useState<WorkFormat[]>([]);
  const [city, setCity] = useState("");
  const [skills, setSkills] = useState("");
  const [primarySkills, setPrimarySkills] = useState("");
  // Раздел ленты: в онбординге показываем направления только выбранного раздела
  const [area, setArea] = useState<Area>("it");
  // Сколько вакансий сейчас в каждом направлении — для живого счётчика под выбором
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    supabase.from("direction_counts").select("direction, vacancies")
      .then(({ data }) => setCounts(Object.fromEntries((data ?? []).map(d => [d.direction, d.vacancies]))));
  }, []);
  const matching = directions.reduce((sum, d) => sum + (counts[d] ?? 0), 0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace("/login?next=/welcome");
      setUserId(user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, skills, primary_skills, pref_directions, pref_level, pref_format, pref_formats, experience_years, pref_city, leads_people")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        setName(profile.name ?? "");
        setDirections(profile.pref_directions ?? []);
        const first = DIRECTIONS.find(d => d.id === profile.pref_directions?.[0]);
        if (first) setArea(first.group);
        setLevel((profile.pref_level as Level | null) ?? "");
        setFormats(profile.pref_formats?.length ? (profile.pref_formats as WorkFormat[]) : profile.pref_format ? [profile.pref_format as WorkFormat] : []);
        setExperience(profile.experience_years != null ? String(profile.experience_years) : "");
        setLeadsPeople(profile.leads_people ?? false);
        setCity(profile.pref_city ?? "");
        const primary = Array.isArray(profile.primary_skills) ? (profile.primary_skills as string[]) : [];
        const primaryLower = new Set(primary.map(x => x.toLowerCase()));
        setPrimarySkills(primary.join(", "));
        setSkills(Array.isArray(profile.skills) ? (profile.skills as string[]).filter(x => !primaryLower.has(x.toLowerCase())).join(", ") : "");
      }
    })();
  }, [router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      name: name.trim(),
      primary_skills: [...new Set(primarySkills.split(",").map(s => s.trim()).filter(Boolean))].slice(0, 5),
      skills: [...new Set([...primarySkills.split(","), ...skills.split(",")].map(s => s.trim()).filter(Boolean))].slice(0, 50),
      pref_directions: directions,
      experience_years: parseExperience(experience),
      leads_people: leadsPeople,
      pref_level: levelApplies(directions) ? level || null : null,
      level_source: levelApplies(directions) && level ? "manual" : null,
      pref_formats: formats,
      pref_format: formats[0] ?? null,
      pref_city: city.trim() || null,
    }).eq("id", userId);
    setSaving(false);
    if (error) {
      toast(saveErrorText(error.message), "error");
      return;
    }
    router.push("/?tab=for-you");
    router.refresh();
  }

  if (!userId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-teal-300" />
      </div>
    );
  }

  return (
    <main className="min-h-screen text-neutral-100 px-4 py-8">
      <div className="max-w-2xl mx-auto mb-6"><Logo /></div>
      <form onSubmit={save} className="glass max-w-2xl mx-auto rounded-3xl p-6 sm:p-8 space-y-7">
        <header className="space-y-2">
          <p className="text-xs font-mono text-teal-300 uppercase tracking-wider">Займёт минуту</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Что вы ищете?</h1>
          <p className="text-sm text-neutral-400">
            Ответьте на пару вопросов — лента выстроится под вас, а у каждой вакансии появится процент совпадения.
          </p>
        </header>

        <Link href="/profile" className="lg lg-tint flex items-center gap-3 rounded-2xl p-4 transition-colors">
          <Sparkles className="w-5 h-5 text-teal-300 shrink-0" aria-hidden="true" />
          <span className="text-sm">
            <span className="block font-semibold text-white">Есть резюме? Загрузите его — ИИ заполнит всё сам</span>
            <span className="block text-neutral-400">Навыки, опыт, уровень с объяснением и что вы ищете. Останется проверить.</span>
          </span>
        </Link>

        <div>
          <label htmlFor="name" className={labelClass}>Как вас зовут</label>
          <input id="name" required maxLength={200} value={name} onChange={e => setName(e.target.value)}
            placeholder="Имя и фамилия" className={inputClass} />
        </div>

        <div className="space-y-3">
          <span className={labelClass}>Направления (до {MAX_DIRECTIONS})</span>
          <div role="group" aria-label="Раздел" className="neu-in inline-flex flex-wrap gap-1 p-1 rounded-full">
            {AREAS.map(a => (
              <button key={a.id} type="button" aria-pressed={area === a.id} onClick={() => setArea(a.id)}
                className={`lg text-sm px-3.5 py-1.5 rounded-full transition-colors ${area === a.id
                  ? "lg lg-accent" : "text-neutral-400 hover:text-neutral-200"}`}>
                {a.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {DIRECTIONS.filter(d => d.group === area || directions.includes(d.id)).map(d => {
              const on = directions.includes(d.id);
              const full = !on && directions.length >= MAX_DIRECTIONS;
              return (
                <button key={d.id} type="button" disabled={full} aria-pressed={on}
                  onClick={() => setDirections(prev => on ? prev.filter(x => x !== d.id) : [...prev, d.id])}
                  className={chip(on) + (full ? " opacity-40 cursor-not-allowed" : "")}>
                  {d.label}
                </button>
              );
            })}
          </div>
          <p aria-live="polite" className="flex items-center gap-2 text-sm text-neutral-400 min-h-5">
            {directions.length > 0 && matching > 0 && (
              <>
                <span className="relative inline-flex w-2 h-2" aria-hidden="true">
                  <span className="live-ping absolute inset-0 rounded-full bg-teal-300" />
                  <span className="relative w-2 h-2 rounded-full bg-teal-300" />
                </span>
                Сейчас по этим направлениям{" "}
                <span className="font-semibold text-teal-300">{matching.toLocaleString("ru-RU")}</span>{" "}
                {plural(matching, ["вакансия", "вакансии", "вакансий"])}
              </>
            )}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          <ExperienceInput years={experience} leads={leadsPeople} labelClass={labelClass}
            onChange={(y, l) => { setExperience(y); setLeadsPeople(l); }} />
          {levelApplies(directions) && (
            <div className="sm:col-span-2">
              <LevelPicker level={level} source={level ? "manual" : null} reason={null} labelClass={labelClass} onChange={setLevel} />
            </div>
          )}
          <div>
            <span className={labelClass}>Формат</span>
            <div className="flex flex-wrap gap-2">
              {WORK_FORMATS.map(f => (
                <button key={f.id} type="button" aria-pressed={formats.includes(f.id)}
                  onClick={() => setFormats(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                  className={chip(formats.includes(f.id))}>{f.label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <label htmlFor="city" className={labelClass}>Город</label>
            <input id="city" maxLength={100} value={city} onChange={e => setCity(e.target.value)} placeholder="Москва" className={inputClass} />
          </div>
          <div>
            <label htmlFor="primary-skills" className={labelClass}>Основной стек</label>
            <input id="primary-skills" value={primarySkills} onChange={e => setPrimarySkills(e.target.value)} placeholder="Java, Spring или Figma" className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="skills" className={labelClass}>Другие навыки</label>
            <input id="skills" value={skills} onChange={e => setSkills(e.target.value)} placeholder="PostgreSQL, Kafka, Docker…" className={inputClass} />
          </div>
        </div>

        <p className="text-xs text-neutral-500">
          Есть резюме в PDF? Загрузите его в <Link href="/profile" className="text-teal-300 hover:underline">профиле</Link> —
          ИИ заполнит опыт и навыки за вас.
        </p>

        <button type="submit" disabled={saving || !name.trim()}
          className="lg lg-accent w-full flex items-center justify-center gap-2 py-3.5 rounded-full text-sm font-semibold transition-colors disabled:opacity-50">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Показать мои вакансии</>}
        </button>
      </form>
    </main>
  );
}
