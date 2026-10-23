"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/Toaster";
import { DIRECTIONS, LEVELS, WORK_FORMATS, type Level, type WorkFormat } from "@/lib/vacancies";

const MAX_DIRECTIONS = 5;

const inputClass =
  "w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors";
const labelClass = "block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2";
const chip = (active: boolean) =>
  `text-sm px-3 py-1.5 rounded-lg border transition-colors ${active
    ? "bg-blue-600 border-blue-500 text-white"
    : "bg-neutral-950 border-neutral-700 text-neutral-300 hover:border-neutral-500"}`;

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
  const [format, setFormat] = useState<WorkFormat | "">("");
  const [city, setCity] = useState("");
  const [skills, setSkills] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace("/login?next=/welcome");
      setUserId(user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, skills, pref_directions, pref_level, pref_format, pref_city")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        setName(profile.name ?? "");
        setDirections(profile.pref_directions ?? []);
        setLevel((profile.pref_level as Level | null) ?? "");
        setFormat((profile.pref_format as WorkFormat | null) ?? "");
        setCity(profile.pref_city ?? "");
        setSkills(Array.isArray(profile.skills) ? profile.skills.join(", ") : "");
      }
    })();
  }, [router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      name: name.trim(),
      skills: [...new Set(skills.split(",").map(s => s.trim()).filter(Boolean))].slice(0, 50),
      pref_directions: directions,
      pref_level: level || null,
      pref_format: format || null,
      pref_city: city.trim() || null,
    }).eq("id", userId);
    setSaving(false);
    if (error) {
      toast("Не удалось сохранить: " + error.message, "error");
      return;
    }
    router.push("/?tab=for-you");
    router.refresh();
  }

  if (!userId) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-8">
      <form onSubmit={save} className="max-w-2xl mx-auto space-y-7">
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">Что вы ищете?</h1>
          <p className="text-sm text-neutral-400">
            Минута — и лента выстроится под вас: у каждой вакансии появится процент совпадения.
          </p>
        </header>

        <div>
          <label htmlFor="name" className={labelClass}>Как вас зовут</label>
          <input id="name" required maxLength={200} value={name} onChange={e => setName(e.target.value)}
            placeholder="Имя и фамилия" className={inputClass} />
        </div>

        <div>
          <span className={labelClass}>Направления (до {MAX_DIRECTIONS})</span>
          <div className="flex flex-wrap gap-2">
            {DIRECTIONS.map(d => {
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
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <span className={labelClass}>Уровень</span>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map(l => (
                <button key={l.id} type="button" aria-pressed={level === l.id}
                  onClick={() => setLevel(level === l.id ? "" : l.id)} className={chip(level === l.id)}>{l.label}</button>
              ))}
            </div>
          </div>
          <div>
            <span className={labelClass}>Формат</span>
            <div className="flex flex-wrap gap-2">
              {WORK_FORMATS.map(f => (
                <button key={f.id} type="button" aria-pressed={format === f.id}
                  onClick={() => setFormat(format === f.id ? "" : f.id)} className={chip(format === f.id)}>{f.label}</button>
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
            <label htmlFor="skills" className={labelClass}>Ключевые навыки</label>
            <input id="skills" value={skills} onChange={e => setSkills(e.target.value)} placeholder="Python, SQL, Figma…" className={inputClass} />
          </div>
        </div>

        <p className="text-xs text-neutral-500">
          Есть резюме в PDF? Загрузите его в <Link href="/profile" className="text-blue-400 hover:underline">профиле</Link> —
          ИИ заполнит опыт и навыки за вас.
        </p>

        <button type="submit" disabled={saving || !name.trim()}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Показать мои вакансии</>}
        </button>
      </form>
    </main>
  );
}
