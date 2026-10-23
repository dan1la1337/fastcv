"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Briefcase, FileText, Loader2, LogOut, Save, Sparkles, Trash2, Upload, UserCircle } from "lucide-react";
import type { ResumeDraft } from "@/lib/resume-draft";
import TelegramSubscription from "@/components/TelegramSubscription";
import { supabase, getUserRole, type UserRole } from "@/lib/supabase";
import { DIRECTIONS, WORK_FORMATS, experienceFields, type Level, type WorkFormat } from "@/lib/vacancies";
import ExperienceInput from "@/components/ExperienceInput";

const MAX_DIRECTIONS = 5; // как в ограничении profiles_pref_directions_check

const RESUME_MAX_BYTES = 5 * 1024 * 1024; // совпадает с лимитом бакета resumes

const inputClass =
  "w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-200 focus:outline-none focus:border-blue-500 transition-colors";
const labelClass = "block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2";
const chip = (active: boolean) =>
  `text-xs px-3 py-1.5 rounded-lg border transition-colors ${active
    ? "bg-blue-600 border-blue-500 text-white"
    : "bg-neutral-950 border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"}`;

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>("candidate");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [skills, setSkills] = useState("");

  // Что ищет кандидат: по этому строится подборка «Для вас» и процент совпадения
  const [prefDirections, setPrefDirections] = useState<string[]>([]);
  const [prefLevel, setPrefLevel] = useState<Level | "">("");
  const [experience, setExperience] = useState("");
  const [leadsPeople, setLeadsPeople] = useState(false);
  const [prefFormats, setPrefFormats] = useState<WorkFormat[]>([]);
  const [prefCity, setPrefCity] = useState("");
  const [prefSalary, setPrefSalary] = useState("");

  const [resumePath, setResumePath] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setUser(user);
      setRole(await getUserRole(user));

      const { data: profile } = await supabase
        .from("profiles")
        .select("name, description, skills, resume_path, pref_directions, pref_level, pref_format, pref_formats, experience_years, pref_city, pref_salary")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        setName(profile.name || "");
        setDescription(profile.description || "");
        setSkills(Array.isArray(profile.skills) ? profile.skills.join(", ") : "");
        setResumePath(profile.resume_path ?? null);
        setPrefDirections(profile.pref_directions ?? []);
        setPrefLevel((profile.pref_level as Level | null) ?? "");
        setPrefFormats(profile.pref_formats?.length ? (profile.pref_formats as WorkFormat[]) : profile.pref_format ? [profile.pref_format as WorkFormat] : []);
        setExperience(profile.experience_years != null ? String(profile.experience_years) : "");
        setLeadsPeople(profile.pref_level === "lead");
        setPrefCity(profile.pref_city ?? "");
        setPrefSalary(profile.pref_salary ? String(profile.pref_salary) : "");
      }
      setLoading(false);
    })();
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setNotice(null);

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      role, // роль менять нельзя: база отклонит попытку (триггер prevent_role_change)
      name: name.trim(),
      description: description.trim(),
      skills: skills.split(",").map(s => s.trim()).filter(Boolean),
      ...(role === "candidate" ? {
        pref_directions: prefDirections,
        ...experienceFields(experience, leadsPeople, prefLevel),
        pref_formats: prefFormats,
        pref_format: prefFormats[0] ?? null,
        pref_city: prefCity.trim() || null,
        pref_salary: Number(prefSalary.replace(/\D/g, "")) || null,
      } : {}),
    });

    setSaving(false);
    setNotice(error
      ? { kind: "error", text: "Не удалось сохранить профиль: " + error.message }
      : { kind: "ok", text: role === "candidate" ? "Профиль сохранён. Подборка «Для вас» на главной обновлена." : "Профиль сохранён." });
  }

  async function uploadResume(file: File) {
    if (!user) return;
    setNotice(null);
    if (file.type !== "application/pdf") {
      setNotice({ kind: "error", text: "Нужен файл в формате PDF." });
      return;
    }
    if (file.size > RESUME_MAX_BYTES) {
      setNotice({ kind: "error", text: "Файл больше 5 МБ. Сожмите PDF или уберите лишние страницы." });
      return;
    }
    setResumeBusy(true);
    // Папка = id пользователя: так правила хранилища пускают его только в свою папку
    const path = `${user.id}/resume.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("resumes")
      .upload(path, file, { upsert: true, contentType: "application/pdf" });
    if (!uploadError) {
      const { error } = await supabase.from("profiles").update({ resume_path: path }).eq("id", user.id);
      if (!error) {
        setResumePath(path);
        setNotice({ kind: "ok", text: "Резюме загружено. Работодатели увидят его в ваших откликах." });
      } else {
        setNotice({ kind: "error", text: "Файл загружен, но не привязан к профилю: " + error.message });
      }
    } else {
      setNotice({ kind: "error", text: "Не удалось загрузить резюме: " + uploadError.message });
    }
    setResumeBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function openResume() {
    if (!resumePath) return;
    // Бакет приватный: открываем по временной ссылке на 5 минут
    const { data, error } = await supabase.storage.from("resumes").createSignedUrl(resumePath, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else setNotice({ kind: "error", text: "Не удалось открыть резюме: " + (error?.message ?? "нет ссылки") });
  }

  async function removeResume() {
    if (!user || !resumePath) return;
    setResumeBusy(true);
    setNotice(null);
    const { error } = await supabase.storage.from("resumes").remove([resumePath]);
    if (!error) {
      await supabase.from("profiles").update({ resume_path: null }).eq("id", user.id);
      setResumePath(null);
      setNotice({ kind: "ok", text: "Резюме удалено." });
    } else {
      setNotice({ kind: "error", text: "Не удалось удалить резюме: " + error.message });
    }
    setResumeBusy(false);
  }

  // ИИ читает резюме и предлагает поля; пустые заполняем, навыки дополняем,
  // заполненное кандидатом не трогаем. Сохраняет он сам — после проверки.
  async function autofillFromResume() {
    setAutofilling(true);
    setNotice(null);
    try {
      const res = await fetch("/api/resume-autofill", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.draft) {
        setNotice({ kind: "error", text: data.error || "Не удалось разобрать резюме." });
        return;
      }
      const draft = data.draft as ResumeDraft;
      if (!name.trim() && draft.name) setName(draft.name);
      if (!description.trim() && draft.about) setDescription(draft.about);
      if (draft.skills.length) {
        const current = skills.split(",").map(s => s.trim()).filter(Boolean);
        const lower = new Set(current.map(s => s.toLowerCase()));
        setSkills([...current, ...draft.skills.filter(s => !lower.has(s.toLowerCase()))].join(", "));
      }
      if (!prefDirections.length && draft.directions.length) setPrefDirections(draft.directions.slice(0, MAX_DIRECTIONS));
      if (!prefLevel && draft.level) setPrefLevel(draft.level as Level);
      if (!prefCity.trim() && draft.city) setPrefCity(draft.city);
      if (!prefSalary && draft.salary) setPrefSalary(String(draft.salary));
      setNotice({ kind: "ok", text: "Поля заполнены по резюме. Проверьте их и нажмите «Сохранить профиль»." });
    } catch {
      setNotice({ kind: "error", text: "Не удалось связаться с сервером. Попробуйте ещё раз." });
    } finally {
      setAutofilling(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const isCandidate = role === "candidate";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="bg-blue-600 text-white font-black px-2.5 py-1 rounded-lg text-sm tracking-tight shadow-lg shadow-blue-500/25">⚡ Fast<span className="text-blue-200">CV</span></span>
          </Link>
          <button onClick={handleLogout} className="text-sm text-neutral-400 hover:text-white flex items-center gap-2 transition-colors">
            <LogOut className="w-4 h-4" /> Выйти
          </button>
        </div>

        {notice && (
          <div className={`rounded-xl px-4 py-3 text-sm border ${
            notice.kind === "ok" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border-red-500/20 text-red-300"
          }`}>
            {notice.text}
          </div>
        )}

        <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-6 sm:p-8 shadow-xl">
          <h1 className="text-2xl font-bold mb-6 text-white">Личный кабинет</h1>

          <form onSubmit={saveProfile} className="space-y-6">
            <div>
              <label className={labelClass}>Тип аккаунта</label>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-sm font-medium text-neutral-300">
                {isCandidate
                  ? <><UserCircle className="w-4 h-4 text-emerald-400" /> Соискатель</>
                  : <><Briefcase className="w-4 h-4 text-blue-400" /> Работодатель</>}
              </div>
            </div>

            <div>
              <label className={labelClass}>{isCandidate ? "Ваше имя" : "Название компании"}</label>
              <input required type="text" maxLength={200} value={name} onChange={e => setName(e.target.value)}
                placeholder={isCandidate ? "Например, Иван Иванов" : "Например, ООО Технологии"} className={inputClass} />
            </div>

            {isCandidate && (
              <div>
                <label className={labelClass}>Ключевые навыки (через запятую)</label>
                <input type="text" value={skills} onChange={e => setSkills(e.target.value)}
                  placeholder="React, Node.js, Python..." className={inputClass} />
              </div>
            )}

            {isCandidate && (
              <fieldset id="prefs" className="space-y-5 border-t border-neutral-800 pt-6">
                <legend className="text-base font-semibold text-white">Что ищу</legend>
                <p className="text-xs text-neutral-500 -mt-2">По этим ответам и навыкам считается совпадение с вакансиями и подборка «Для вас».</p>

                <div>
                  <span className={labelClass}>Направления (до {MAX_DIRECTIONS})</span>
                  <div className="flex flex-wrap gap-2">
                    {DIRECTIONS.map(d => {
                      const on = prefDirections.includes(d.id);
                      const full = !on && prefDirections.length >= MAX_DIRECTIONS;
                      return (
                        <button key={d.id} type="button" disabled={full} aria-pressed={on}
                          onClick={() => setPrefDirections(prev => on ? prev.filter(x => x !== d.id) : [...prev, d.id])}
                          className={chip(on) + (full ? " opacity-40 cursor-not-allowed" : "")}>
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <ExperienceInput years={experience} leads={leadsPeople} labelClass={labelClass}
                  onChange={(y, l) => { setExperience(y); setLeadsPeople(l); }} />

                <div>
                  <span className={labelClass}>Формат работы</span>
                  <div className="flex flex-wrap gap-2">
                    {WORK_FORMATS.map(f => (
                      <button key={f.id} type="button" aria-pressed={prefFormats.includes(f.id)}
                        onClick={() => setPrefFormats(prev => prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id])}
                        className={chip(prefFormats.includes(f.id))}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="pref-city" className={labelClass}>Город</label>
                    <input id="pref-city" type="text" maxLength={100} value={prefCity} onChange={e => setPrefCity(e.target.value)}
                      placeholder="Москва" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="pref-salary" className={labelClass}>Зарплата от, ₽ в месяц</label>
                    <input id="pref-salary" type="text" inputMode="numeric" value={prefSalary}
                      onChange={e => setPrefSalary(e.target.value.replace(/[^\d ]/g, ""))}
                      placeholder="150 000" className={inputClass} />
                  </div>
                </div>
              </fieldset>
            )}

            <div>
              <label className={labelClass}>{isCandidate ? "Опыт работы и о себе" : "Описание компании"}</label>
              <textarea required value={description} onChange={e => setDescription(e.target.value)}
                placeholder={isCandidate ? "Подробно расскажите о вашем опыте — по нему ИИ пишет сопроводительные письма" : "Расскажите о вашей компании и проектах..."}
                className={`${inputClass} h-32 resize-y leading-relaxed`} />
            </div>

            <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-4 h-4" /> Сохранить профиль</>}
            </button>
          </form>
        </div>

        {isCandidate && (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-6 sm:p-8 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white">Резюме</h2>
              <p className="text-sm text-neutral-400 mt-1">
                PDF до 5 МБ. Его увидят только работодатели, на чьи вакансии вы откликнулись.
              </p>
            </div>

            {resumePath && (
              <button onClick={autofillFromResume} disabled={autofilling}
                className="w-full flex items-center justify-center gap-2 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 text-blue-300 rounded-xl py-3 text-sm font-medium transition-colors disabled:opacity-50">
                {autofilling
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> ИИ читает резюме…</>
                  : <><Sparkles className="w-4 h-4" /> Заполнить профиль по резюме</>}
              </button>
            )}

            {resumePath ? (
              <div className="flex flex-wrap items-center gap-3 bg-neutral-950 border border-neutral-800 rounded-xl p-4">
                <FileText className="w-5 h-5 text-blue-400 shrink-0" />
                <button onClick={openResume} className="text-sm text-neutral-200 hover:text-blue-400 underline-offset-2 hover:underline">
                  resume.pdf
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => fileInput.current?.click()} disabled={resumeBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-800 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50">
                    <Upload className="w-3.5 h-3.5" /> Заменить
                  </button>
                  <button onClick={removeResume} disabled={resumeBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-800 text-xs text-neutral-300 hover:text-red-300 hover:bg-red-950/30 disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" /> Удалить
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => fileInput.current?.click()} disabled={resumeBusy}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-neutral-700 hover:border-blue-500 rounded-xl py-6 text-sm text-neutral-300 transition-colors disabled:opacity-50">
                {resumeBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Upload className="w-4 h-4" /> Загрузить PDF</>}
              </button>
            )}

            <input ref={fileInput} type="file" accept="application/pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadResume(f); }} />
          </div>
        )}

        {isCandidate && user && <TelegramSubscription userId={user.id} />}
      </div>
    </div>
  );
}
