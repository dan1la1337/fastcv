"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { Briefcase, FileText, Loader2, Save, Sparkles, Trash2, Upload, UserCircle } from "lucide-react";
import type { ResumeDraft } from "@/lib/resume-draft";
import TelegramSubscription from "@/components/TelegramSubscription";
import DeleteAccount from "@/components/DeleteAccount";
import ResumeVisibility from "@/components/ResumeVisibility";
import CompanyVerification from "@/components/CompanyVerification";
import { supabase, getUserRole, type UserRole } from "@/lib/supabase";
import { AREAS, DIRECTIONS, WORK_FORMATS, levelApplies, parseExperience, type Level, type WorkFormat } from "@/lib/vacancies";
import LevelPicker from "@/components/LevelPicker";
import ExperienceInput from "@/components/ExperienceInput";
import Logo from "@/components/Logo";
import AppBar from "@/components/AppBar";
import UserMenu from "@/components/UserMenu";
import { toast } from "@/components/Toaster";
import { saveErrorText } from "@/lib/auth-errors";

const MAX_DIRECTIONS = 5; // как в ограничении profiles_pref_directions_check

const RESUME_MAX_BYTES = 5 * 1024 * 1024; // совпадает с лимитом бакета resumes

const inputClass =
  "w-full neu-in rounded-2xl px-4 py-3 text-sm text-neutral-200 transition-colors";
const labelClass = "block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2";
const chip = (active: boolean) =>
  `text-xs px-3 py-1.5 rounded-full transition-colors ${active
    ? "lg lg-on"
    : "lg text-neutral-400 hover:text-neutral-100"}`;

const splitList = (text: string) => [...new Map(text.split(",").map(s => s.trim()).filter(Boolean).map(s => [s.toLowerCase(), s])).values()];

/** Навыки для сохранения: skills — все (основной стек первым), primary_skills — до 5 основных. */
function skillFields(primary: string, rest: string, candidate: boolean) {
  const main = splitList(primary).slice(0, 5);
  const all = splitList([...main, ...splitList(rest)].join(","));
  return candidate ? { skills: all.slice(0, 50), primary_skills: main } : { skills: all.slice(0, 50) };
}

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
  // Основной стек (язык и платформа) — решает в совпадении; skills — дополнительные навыки
  const [primarySkills, setPrimarySkills] = useState("");

  // Что ищет кандидат: по этому строится подборка «Для вас» и процент совпадения
  const [prefDirections, setPrefDirections] = useState<string[]>([]);
  const [prefLevel, setPrefLevel] = useState<Level | "">("");
  const [experience, setExperience] = useState("");
  const [leadsPeople, setLeadsPeople] = useState(false);
  // Уровень: кто поставил (ИИ по резюме или сам кандидат) и объяснение ИИ
  const [levelSource, setLevelSource] = useState<"ai" | "manual" | null>(null);
  const [levelReason, setLevelReason] = useState<string | null>(null);
  const [prefFormats, setPrefFormats] = useState<WorkFormat[]>([]);
  const [prefCity, setPrefCity] = useState("");
  const [prefSalary, setPrefSalary] = useState("");

  const [resumePath, setResumePath] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  // Текст «О себе» из резюме, если свой уже написан: подставляется по кнопке
  const [aboutDraft, setAboutDraft] = useState<string | null>(null);
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
        .select("name, description, skills, primary_skills, resume_path, pref_directions, pref_level, pref_format, pref_formats, experience_years, pref_city, pref_salary, leads_people, level_reason, level_source")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        setName(profile.name || "");
        setDescription(profile.description || "");
        const all = Array.isArray(profile.skills) ? (profile.skills as string[]) : [];
        const primary = Array.isArray(profile.primary_skills) ? (profile.primary_skills as string[]) : [];
        const primaryLower = new Set(primary.map(x => x.toLowerCase()));
        setPrimarySkills(primary.join(", "));
        setSkills(all.filter(x => !primaryLower.has(x.toLowerCase())).join(", "));
        setResumePath(profile.resume_path ?? null);
        setPrefDirections(profile.pref_directions ?? []);
        setPrefLevel((profile.pref_level as Level | null) ?? "");
        setPrefFormats(profile.pref_formats?.length ? (profile.pref_formats as WorkFormat[]) : profile.pref_format ? [profile.pref_format as WorkFormat] : []);
        setExperience(profile.experience_years != null ? String(profile.experience_years) : "");
        setLeadsPeople(profile.leads_people ?? false);
        setLevelSource((profile.level_source as "ai" | "manual" | null) ?? null);
        setLevelReason(profile.level_reason ?? null);
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
      ...skillFields(primarySkills, skills, role === "candidate"),
      ...(role === "candidate" ? {
        pref_directions: prefDirections,
        experience_years: parseExperience(experience),
        leads_people: leadsPeople,
        pref_level: levelApplies(prefDirections) ? prefLevel || null : null,
        level_source: levelApplies(prefDirections) && prefLevel ? levelSource ?? "manual" : null,
        level_reason: levelApplies(prefDirections) ? levelReason : null,
        pref_formats: prefFormats,
        pref_format: prefFormats[0] ?? null,
        pref_city: prefCity.trim() || null,
        pref_salary: Number(prefSalary.replace(/\D/g, "")) || null,
      } : {}),
    });

    setSaving(false);
    const result = error
      ? { kind: "error" as const, text: saveErrorText(error.message) }
      : { kind: "ok" as const, text: role === "candidate" ? "Профиль сохранён. Подборка «Для вас» на главной обновлена." : "Профиль сохранён." };
    setNotice(result);
    toast(result.text, result.kind);   // кнопка внизу, плашка — вверху страницы
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
        setResumeBusy(false);
        if (fileInput.current) fileInput.current.value = "";
        // Сразу заполняем профиль по резюме — ради этого его обычно и загружают
        await autofillFromResume();
        return;
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
      // Кандидат сам нажал «заполнить по резюме» — подставляем всё, что ИИ нашёл;
      // текст «О себе» не затираем, если он уже написан. Сохраняет кандидат после проверки.
      if (draft.name) setName(draft.name);
      if (draft.about && !description.trim()) setDescription(draft.about);
      const primary = draft.primary_skills.length ? draft.primary_skills : splitList(primarySkills);
      if (draft.primary_skills.length) setPrimarySkills(draft.primary_skills.join(", "));
      if (draft.skills.length) {
        const primaryLower = new Set(primary.map(s => s.toLowerCase()));
        const current = splitList(skills).filter(s => !primaryLower.has(s.toLowerCase()));
        const lower = new Set(current.map(s => s.toLowerCase()));
        setSkills([...current, ...draft.skills.filter(s => !lower.has(s.toLowerCase()) && !primaryLower.has(s.toLowerCase()))].join(", "));
      }
      if (draft.directions.length) setPrefDirections(draft.directions.slice(0, MAX_DIRECTIONS));
      if (draft.experience_years != null) setExperience(String(draft.experience_years));
      setLeadsPeople(draft.leads_people);
      if (draft.formats.length) setPrefFormats(draft.formats as WorkFormat[]);
      if (draft.level) {
        setPrefLevel(draft.level as Level);
        setLevelSource("ai");
        setLevelReason(draft.level_reason);
      }
      if (draft.city) setPrefCity(draft.city);
      if (draft.salary) setPrefSalary(String(draft.salary));
      setAboutDraft(draft.about && description.trim() && draft.about !== description.trim() ? draft.about : null);
      setNotice({ kind: "ok", text: "Профиль заполнен по резюме. Проверьте поля и нажмите «Сохранить профиль»." });
      document.getElementById("profile-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setNotice({ kind: "error", text: "Не удалось связаться с сервером. Попробуйте ещё раз." });
    } finally {
      setAutofilling(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-teal-300" />
      </div>
    );
  }

  const isCandidate = role === "candidate";

  return (
    <>
    <AppBar role={isCandidate ? "candidate" : "employer"} />
    <div className="min-h-screen text-neutral-100 font-sans p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* На телефоне верхней панели нет: логотип и меню аккаунта стоят в самой странице */}
        <div className="flex items-center justify-between sm:hidden">
          <Logo />
          <UserMenu role={isCandidate ? "candidate" : "employer"} />
        </div>

        {notice && (
          <div className={`rounded-xl px-4 py-3 text-sm border ${
            notice.kind === "ok" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border-red-500/20 text-red-300"
          }`}>
            {notice.text}
          </div>
        )}

        {isCandidate && (
          <div className="glass rounded-3xl p-6 sm:p-8 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white inline-flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-teal-300" aria-hidden="true" /> {resumePath ? "Резюме" : "Заполните профиль за минуту"}
              </h2>
              <p className="text-sm text-neutral-400 mt-1">
                {resumePath
                  ? "ИИ берёт из резюме навыки, опыт по датам мест работы, руководство людьми и оценивает уровень с объяснением."
                  : "Загрузите резюме в PDF — ИИ сам заполнит навыки, опыт, уровень и что вы ищете. Останется проверить."}
                {" "}PDF до 5 МБ; его увидят работодатели, на чьи вакансии вы откликнулись.
              </p>
            </div>

            {resumePath && (
              <button onClick={autofillFromResume} disabled={autofilling}
                className="lg lg-tint w-full flex items-center justify-center gap-2 text-teal-200 rounded-xl py-3 text-sm font-medium transition-colors disabled:opacity-50">
                {autofilling
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> ИИ читает резюме…</>
                  : <><Sparkles className="w-4 h-4" /> Заполнить профиль по резюме заново</>}
              </button>
            )}

            {resumePath ? (
              <div className="neu-in flex flex-wrap items-center gap-3 rounded-2xl p-4">
                <FileText className="w-5 h-5 text-teal-300 shrink-0" />
                <button onClick={openResume} className="text-sm text-neutral-200 hover:text-teal-300 underline-offset-2 hover:underline">
                  resume.pdf
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => fileInput.current?.click()} disabled={resumeBusy}
                    className="lg inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-neutral-300 disabled:opacity-50">
                    <Upload className="w-3.5 h-3.5" /> Заменить
                  </button>
                  <button onClick={removeResume} disabled={resumeBusy}
                    className="lg inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-neutral-300 hover:text-red-300 disabled:opacity-50">
                    <Trash2 className="w-3.5 h-3.5" /> Удалить
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => fileInput.current?.click()} disabled={resumeBusy}
                className="lg lg-accent w-full flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold transition-colors disabled:opacity-50">
                {resumeBusy || autofilling
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> {autofilling ? "ИИ читает резюме…" : "Загружаем…"}</>
                  : <><Upload className="w-4 h-4" /> Загрузить резюме (PDF)</>}
              </button>
            )}

            <input ref={fileInput} type="file" accept="application/pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadResume(f); }} />
          </div>
        )}

        <div className="glass rounded-3xl p-6 sm:p-8">
          <h1 id="top" className="font-display text-2xl font-bold mb-6 text-white scroll-mt-6">Личный кабинет</h1>

          <form id="profile-form" onSubmit={saveProfile} className="space-y-6 scroll-mt-6">
            <div>
              <label className={labelClass}>Тип аккаунта</label>
              <div className="neu-in inline-flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium text-neutral-300">
                {isCandidate
                  ? <><UserCircle className="w-4 h-4 text-emerald-400" /> Соискатель</>
                  : <><Briefcase className="w-4 h-4 text-teal-300" /> Работодатель</>}
              </div>
            </div>

            <div>
              <label className={labelClass}>{isCandidate ? "Ваше имя" : "Название компании"}</label>
              <input required type="text" maxLength={200} value={name} onChange={e => setName(e.target.value)}
                placeholder={isCandidate ? "Например, Иван Иванов" : "Например, ООО Технологии"} className={inputClass} />
            </div>

            {isCandidate && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="primary-skills" className={labelClass}>Основной стек — язык и платформа (до 5)</label>
                  <input id="primary-skills" type="text" value={primarySkills} onChange={e => setPrimarySkills(e.target.value)}
                    placeholder="Java, Spring" className={inputClass} />
                  <p className="text-xs text-neutral-500 mt-1.5">
                    На чём вы работаете. Решает в совпадении: вакансия на чужом языке не поднимется выше 40%, даже если совпали базы и инфраструктура.
                  </p>
                </div>
                <div>
                  <label htmlFor="other-skills" className={labelClass}>Дополнительные навыки (через запятую)</label>
                  <input id="other-skills" type="text" value={skills} onChange={e => setSkills(e.target.value)}
                    placeholder="PostgreSQL, Kafka, Docker, Kubernetes…" className={inputClass} />
                </div>
              </div>
            )}

            {isCandidate && (
              <fieldset id="prefs" className="space-y-5 border-t border-white/10 pt-6">
                <legend className="text-base font-semibold text-white">Что ищу</legend>
                <p className="text-xs text-neutral-500 -mt-2">По этим ответам и навыкам считается совпадение с вакансиями и подборка «Для вас».</p>

                <div>
                  <span className={labelClass}>Направления (до {MAX_DIRECTIONS})</span>
                  <div className="space-y-3">
                    {AREAS.map(a => (
                      <div key={a.id}>
                        <p className="text-xs text-neutral-500 mb-1.5">{a.label}</p>
                        <div className="flex flex-wrap gap-2">
                          {DIRECTIONS.filter(d => d.group === a.id).map(d => {
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
                    ))}
                  </div>
                </div>

                <ExperienceInput years={experience} leads={leadsPeople} labelClass={labelClass}
                  onChange={(y, l) => { setExperience(y); setLeadsPeople(l); }} />

                {levelApplies(prefDirections) && (
                  <LevelPicker level={prefLevel} source={levelSource} reason={levelReason} labelClass={labelClass}
                    onChange={l => { setPrefLevel(l); setLevelSource(l ? "manual" : null); }} />
                )}

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
              {isCandidate && aboutDraft && (
                <button type="button" onClick={() => { setDescription(aboutDraft); setAboutDraft(null); }}
                  className="mb-2 inline-flex items-center gap-1.5 text-xs text-teal-300 hover:text-teal-200">
                  <Sparkles className="w-3.5 h-3.5" /> Заменить текст на вариант из резюме
                </button>
              )}
              <textarea required value={description} onChange={e => setDescription(e.target.value)}
                placeholder={isCandidate ? "Подробно расскажите о вашем опыте — по нему ИИ пишет сопроводительные письма" : "Расскажите о вашей компании и проектах..."}
                className={`${inputClass} h-32 resize-y leading-relaxed`} />
            </div>

            <button type="submit" disabled={saving} className="lg lg-accent w-full flex items-center justify-center gap-2 py-3.5 rounded-full text-sm font-semibold transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Save className="w-4 h-4" /> Сохранить профиль</>}
            </button>
          </form>
        </div>

        {isCandidate && user && <ResumeVisibility userId={user.id} />}
        {isCandidate && user && <TelegramSubscription userId={user.id} />}
        {!isCandidate && user && <CompanyVerification userId={user.id} />}

        {user && <DeleteAccount userId={user.id} />}
      </div>
    </div>
    </>
  );
}
