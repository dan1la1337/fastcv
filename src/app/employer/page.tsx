"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Archive, Briefcase, CheckCircle2, Eye, FileText, Loader2, Pencil, Plus, RotateCcw, Send, Sparkles, XCircle,
} from "lucide-react";
import { toMatch, type Match } from "@/lib/matching";
import MatchRing from "@/components/MatchRing";
import BlitzAnswers, { type BlitzAnswer } from "@/components/BlitzAnswers";
import type { VacancyDraft } from "@/lib/vacancy-draft";
import { supabase, getUserRole } from "@/lib/supabase";
import { formatSalary, plural, type Vacancy } from "@/lib/vacancies";

type Tab = "applications" | "vacancies" | "form";

interface Application {
  id: string;
  status: string;
  hr_message: string | null;
  cover_letter: string | null;
  created_at: string;
  blitz_answers: BlitzAnswer[];
  blitz_summary: string | null;
  vacancies: { id: string; title: string; employer_id: string };
  profiles: { name: string | null; skills: string[] | null; resume_path: string | null } | null;
}

interface VacancyForm {
  title: string;
  description: string;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  city: string;
  isRemote: boolean;
  /** Технологии через запятую. */
  stack: string;
  /** Микро-блиц: до трёх вопросов кандидату. */
  questions: [string, string, string];
}

const EMPTY_FORM: VacancyForm = {
  title: "", description: "", salaryMin: "", salaryMax: "", currency: "RUB", city: "", isRemote: false, stack: "", questions: ["", "", ""],
};

const STATUS_LABELS: Record<string, string> = {
  new: "Новый отклик",
  viewed: "Просмотрен",
  interview_scheduled: "Собеседование назначено",
  rejected: "Отклонено",
};

// Черновики ответа кандидату; работодатель правит их перед отправкой
const REPLY_TEMPLATES: Record<"interview_scheduled" | "rejected", (vacancy: string) => string> = {
  interview_scheduled: vacancy =>
    `Здравствуйте! Спасибо за отклик на вакансию «${vacancy}». Ваш опыт нам интересен — приглашаем на собеседование. ` +
    "Напишите, пожалуйста, когда вам удобно поговорить на этой неделе.",
  rejected: vacancy =>
    `Здравствуйте! Спасибо за интерес к вакансии «${vacancy}». Сейчас мы продолжим общение с другими кандидатами, ` +
    "чей опыт ближе к задачам. Желаем удачи в поиске!",
};

/** Причина отказа в один клик (план 2.5.1): кандидат получает полезный ответ, а не безликий шаблон. */
const REJECT_REASONS: { label: string; text: string }[] = [
  { label: "Не хватило опыта со стеком", text: "Причина: нам нужен больше практического опыта с основным стеком вакансии." },
  { label: "Вилка выше бюджета", text: "Причина: ваши ожидания по зарплате выше бюджета этой позиции." },
  { label: "Взяли кандидата", text: "Причина: мы уже выбрали кандидата на эту позицию." },
  { label: "Формат или часовой пояс", text: "Причина: не совпали формат работы или часовой пояс." },
];

const inputClass =
  "w-full px-4 py-3 bg-[#0B0F19] border border-white/12 rounded-2xl text-sm text-neutral-100 focus:outline-none focus:border-teal-300";
const labelClass = "block text-xs text-neutral-400 mb-2";

export default function EmployerDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("applications");

  const [form, setForm] = useState<VacancyForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [matches, setMatches] = useState<Record<string, Match>>({});
  const [sortBy, setSortBy] = useState<"new" | "match">("match");
  // Ответ кандидату: какой отклик, какой статус и текст письма
  const [reply, setReply] = useState<{ appId: string; status: "interview_scheduled" | "rejected"; text: string } | null>(null);
  const [replying, setReplying] = useState(false);

  // ИИ-помощник: заметки работодателя → черновик вакансии в форме
  const [notes, setNotes] = useState("");
  const [drafting, setDrafting] = useState(false);

  const loadData = useCallback(async (currentUser: User) => {
    const [{ data: prof }, { data: apps }, { data: own }] = await Promise.all([
      supabase.from("profiles").select("name").eq("id", currentUser.id).maybeSingle(),
      supabase
        .from("applications")
        .select("id, status, hr_message, cover_letter, created_at, blitz_answers, blitz_summary, vacancies!inner (id, title, employer_id), profiles (name, skills, resume_path)")
        .eq("vacancies.employer_id", currentUser.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("vacancies")
        .select("*")
        .eq("employer_id", currentUser.id)
        .order("created_at", { ascending: false }),
    ]);
    setCompanyName(prof?.name || null);
    const loaded = (apps ?? []) as unknown as Application[];
    setApplications(loaded);
    setVacancies((own ?? []) as Vacancy[]);

    const { data: scored } = await supabase.rpc("my_application_matches");
    setMatches(Object.fromEntries((scored ?? []).map(r => [r.application_id, toMatch(r)])));

    // Работодатель открыл кабинет — кандидаты видят, что отклик просмотрен.
    // На экране оставляем «Новый отклик», чтобы было видно, что пришло с прошлого раза.
    const unseen = loaded.filter(a => a.status === "new").map(a => a.id);
    if (unseen.length) await supabase.from("applications").update({ status: "viewed" }).in("id", unseen);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      // Кабинет только для работодателей
      if ((await getUserRole(user)) !== "employer") {
        router.replace("/applications");
        return;
      }
      setUser(user);
      await loadData(user);
      setLoading(false);
    })();
  }, [router, loadData]);

  function openForm(vacancy?: Vacancy) {
    setNotice(null);
    if (vacancy) {
      setEditingId(vacancy.id);
      setForm({
        title: vacancy.title,
        description: vacancy.description ?? "",
        salaryMin: vacancy.salary_min?.toString() ?? "",
        salaryMax: vacancy.salary_max?.toString() ?? "",
        currency: vacancy.salary_currency ?? "RUB",
        city: vacancy.city ?? "",
        isRemote: Boolean(vacancy.is_remote),
        stack: (vacancy.stack ?? []).join(", "),
        questions: [0, 1, 2].map(i => vacancy.blitz_questions?.[i] ?? "") as [string, string, string],
      });
    } else {
      setEditingId(null);
      setForm(EMPTY_FORM);
    }
    setActiveTab("form");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const salaryMin = form.salaryMin ? parseInt(form.salaryMin, 10) : null;
    const salaryMax = form.salaryMax ? parseInt(form.salaryMax, 10) : null;
    if (salaryMin && salaryMax && salaryMin > salaryMax) {
      setNotice({ kind: "error", text: "Зарплата «от» больше, чем «до»." });
      return;
    }
    setSaving(true);
    setNotice(null);

    const fields = {
      title: form.title.trim(),
      description: form.description.trim(),
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: salaryMin || salaryMax ? form.currency : null,
      city: form.city.trim() || null,
      is_remote: form.isRemote,
      company_name: companyName,
      stack: [...new Set(form.stack.split(",").map(s => s.trim()).filter(Boolean))].slice(0, 15),
      blitz_questions: form.questions.map(q => q.trim()).filter(Boolean),
    };

    const { error } = editingId
      ? await supabase.from("vacancies").update(fields).eq("id", editingId)
      : await supabase.from("vacancies").insert({
          ...fields,
          source_type: "internal",
          employer_id: user.id,
          ranking_weight: 1.5, // вакансии прямых работодателей выше в ленте
        });

    setSaving(false);
    if (error) {
      setNotice({ kind: "error", text: "Не удалось сохранить вакансию: " + error.message });
      return;
    }
    await loadData(user);
    setNotice({ kind: "ok", text: editingId ? "Изменения сохранены." : "Вакансия опубликована." });
    setEditingId(null);
    setForm(EMPTY_FORM);
    setActiveTab("vacancies");
  }

  async function draftWithAi() {
    setDrafting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/vacancy-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (!res.ok || !data.draft) {
        setNotice({ kind: "error", text: data.error || "Не удалось написать черновик." });
        return;
      }
      const draft = data.draft as VacancyDraft;
      setForm(prev => ({
        ...prev,
        title: draft.title,
        description: draft.description,
        salaryMin: draft.salary_min ? String(draft.salary_min) : prev.salaryMin,
        salaryMax: draft.salary_max ? String(draft.salary_max) : prev.salaryMax,
        city: draft.city ?? prev.city,
        isRemote: draft.is_remote || prev.isRemote,
        stack: draft.stack.join(", ") || prev.stack,
      }));
      setNotice({ kind: "ok", text: "Черновик готов — проверьте текст и опубликуйте." });
    } catch {
      setNotice({ kind: "error", text: "Не удалось связаться с сервером. Попробуйте ещё раз." });
    } finally {
      setDrafting(false);
    }
  }

  async function setArchived(vacancy: Vacancy, archived: boolean) {
    const { error } = await supabase
      .from("vacancies")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", vacancy.id);
    if (error) {
      setNotice({ kind: "error", text: "Не удалось изменить вакансию: " + error.message });
      return;
    }
    setVacancies(prev => prev.map(v => v.id === vacancy.id ? { ...v, archived_at: archived ? new Date().toISOString() : null } : v));
    setNotice({ kind: "ok", text: archived ? "Вакансия закрыта и скрыта из ленты." : "Вакансия снова в ленте." });
  }

  async function openResume(path: string) {
    // Бакет приватный: временная ссылка на 5 минут. Правила хранилища пускают
    // работодателя только к резюме кандидатов, откликнувшихся на его вакансии.
    const { data, error } = await supabase.storage.from("resumes").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else setNotice({ kind: "error", text: "Не удалось открыть резюме: " + (error?.message ?? "нет ссылки") });
  }

  async function sendReply() {
    if (!reply) return;
    setReplying(true);
    const message = reply.text.trim().slice(0, 2000) || null;
    const { error } = await supabase
      .from("applications")
      .update({ status: reply.status, hr_message: message, hr_replied_at: new Date().toISOString() })
      .eq("id", reply.appId);
    setReplying(false);
    if (error) {
      setNotice({ kind: "error", text: "Не удалось отправить ответ: " + error.message });
      return;
    }
    setApplications(prev => prev.map(app => app.id === reply.appId ? { ...app, status: reply.status, hr_message: message } : app));
    setNotice({ kind: "ok", text: reply.status === "interview_scheduled" ? "Приглашение отправлено — кандидат увидит его в «Моих откликах»." : "Ответ отправлен кандидату." });
    setReply(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-teal-300" />
      </div>
    );
  }

  const openVacancies = vacancies.filter(v => !v.archived_at).length;
  const tabClass = (tab: Tab) =>
    `px-4 py-2 rounded-full text-sm transition-colors ${
      activeTab === tab ? "bg-white/[0.14] text-white" : "text-neutral-400 hover:text-white"
    }`;

  return (
    <div className="min-h-screen text-neutral-100 font-sans p-4 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-bold">Кабинет работодателя</h1>
              <span className="px-3 py-1 rounded-full bg-white/[0.08] text-xs text-neutral-300">для работодателей</span>
            </div>
            <p className="text-sm text-neutral-400">
              Компания: {companyName || <Link href="/profile" className="text-teal-300 hover:underline">укажите в профиле</Link>}
            </p>
          </div>
          <span className="flex-1" />
          <button
            onClick={() => openForm()}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Новая вакансия
          </button>
        </div>

        <div role="tablist" aria-label="Разделы кабинета" className="inline-flex gap-1 p-1 rounded-full bg-white/[0.06]">
          <button role="tab" aria-selected={activeTab === "applications"} onClick={() => setActiveTab("applications")} className={tabClass("applications")}>
            Отклики · {applications.length}
          </button>
          <button role="tab" aria-selected={activeTab === "vacancies"} onClick={() => setActiveTab("vacancies")} className={tabClass("vacancies")}>
            Вакансии · {openVacancies}
          </button>
          {activeTab === "form" && (
            <button role="tab" aria-selected className={tabClass("form")}>{editingId ? "Редактирование" : "Новая вакансия"}</button>
          )}
        </div>

        {notice && (
          <div className={`rounded-xl px-4 py-3 text-sm border ${
            notice.kind === "ok" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-red-500/10 border-red-500/20 text-red-300"
          }`}>
            {notice.text}
          </div>
        )}

        {/* Форма публикации / редактирования */}
        {activeTab === "form" && (
          <div className="glass rounded-3xl p-6 sm:p-8 space-y-6">
            <h2 className="font-display text-lg font-bold">{editingId ? "Редактирование вакансии" : "Новая вакансия"}</h2>
            {!editingId && (
              <div className="rounded-2xl border border-teal-300/25 bg-teal-300/[0.06] p-4 space-y-3">
                <p className="text-sm text-neutral-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-teal-300" /> Опишите вакансию парой фраз — ИИ напишет полный текст
                </p>
                <textarea rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Ищем мидл-бэкендера на Python в финтех, Django + Postgres, удалёнка, 250–300к"
                  className={`${inputClass} resize-y`} />
                <button type="button" onClick={draftWithAi} disabled={drafting || notes.trim().length < 15}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold disabled:opacity-50">
                  {drafting ? <><Loader2 className="w-4 h-4 animate-spin" /> Пишем…</> : "Написать черновик"}
                </button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelClass}>Название должности</label>
                <input required maxLength={200} type="text" placeholder="Например: Senior Java Developer"
                  value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={inputClass} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_8rem] gap-4">
                <div>
                  <label className={labelClass}>Зарплата от</label>
                  <input type="number" min={0} placeholder="150000"
                    value={form.salaryMin} onChange={e => setForm({ ...form, salaryMin: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Зарплата до</label>
                  <input type="number" min={0} placeholder="250000"
                    value={form.salaryMax} onChange={e => setForm({ ...form, salaryMax: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Валюта</label>
                  <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className={inputClass}>
                    {["RUB", "USD", "EUR", "KZT", "BYN", "UZS"].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div>
                  <label className={labelClass}>Город</label>
                  <input type="text" placeholder="Москва" value={form.city}
                    onChange={e => setForm({ ...form, city: e.target.value })} className={inputClass} />
                </div>
                <label className="flex items-center gap-3 cursor-pointer sm:pt-6">
                  <input type="checkbox" checked={form.isRemote} onChange={e => setForm({ ...form, isRemote: e.target.checked })}
                    className="w-5 h-5 accent-teal-300" />
                  <span className="text-sm text-neutral-300">Возможна удалённая работа</span>
                </label>
              </div>

              <div>
                <label className={labelClass}>Технологии (через запятую)</label>
                <input type="text" placeholder="Python, Django, PostgreSQL" value={form.stack}
                  onChange={e => setForm({ ...form, stack: e.target.value })} className={inputClass} />
              </div>

              <fieldset className="space-y-2">
                <legend className={labelClass}>Микро-блиц: до трёх вопросов кандидату (необязательно)</legend>
                <p className="text-xs text-neutral-500 -mt-1">Кандидат ответит на них вместе с письмом, а ИИ сделает выжимку ответов.</p>
                {form.questions.map((q, i) => (
                  <input key={i} type="text" maxLength={200} aria-label={`Вопрос ${i + 1}`}
                    placeholder={["Почему вам интересна эта вакансия?", "Был ли опыт с highload? Расскажите коротко", "Когда готовы выйти?"][i]}
                    value={q} onChange={e => {
                      const questions = [...form.questions] as [string, string, string];
                      questions[i] = e.target.value;
                      setForm({ ...form, questions });
                    }} className={inputClass} />
                ))}
              </fieldset>

              <div>
                <label className={labelClass}>Обязанности и требования</label>
                <textarea required rows={6} placeholder="Опишите стек, проект и задачи кандидата..."
                  value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  className={`${inputClass} leading-relaxed resize-y`} />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button type="submit" disabled={saving}
                  className="flex-1 h-12 bg-teal-300 hover:bg-teal-200 text-neutral-950 rounded-full text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : editingId ? "Сохранить изменения" : "Опубликовать"}
                </button>
                {editingId && (
                  <button type="button" onClick={() => { setEditingId(null); setActiveTab("vacancies"); }}
                    className="px-6 h-12 border border-white/15 rounded-full text-sm text-neutral-300 hover:text-white hover:border-white/30">
                    Отмена
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {/* Мои вакансии */}
        {activeTab === "vacancies" && (
          vacancies.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-white/15 rounded-3xl">
              <Briefcase className="w-10 h-10 mx-auto text-neutral-600 mb-3" />
              <p className="text-neutral-400 text-sm font-medium">У вас пока нет вакансий</p>
              <button onClick={() => openForm()} className="mt-3 text-sm text-teal-300 hover:underline">Опубликовать первую</button>
            </div>
          ) : (
            <div className="grid gap-3">
              {vacancies.map(v => {
                const forVacancy = applications.filter(a => a.vacancies.id === v.id);
                const count = forVacancy.length;
                const invited = forVacancy.filter(a => a.status === "interview_scheduled").length;
                const views = v.views_count ?? 0;
                const top = Math.max(views, count, invited, 1);
                const funnel = [
                  { label: "Просмотры", value: views, color: "bg-indigo-400", word: ["просмотр", "просмотра", "просмотров"] as [string, string, string] },
                  { label: "Отклики", value: count, color: "bg-teal-300", word: ["отклик", "отклика", "откликов"] as [string, string, string] },
                  { label: "Приглашения", value: invited, color: "bg-teal-100", word: ["приглашение", "приглашения", "приглашений"] as [string, string, string] },
                ];
                return (
                  <div key={v.id} className={`glass rounded-3xl p-5 sm:p-6 space-y-4 ${v.archived_at ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="flex-1 min-w-[14rem]">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-display text-lg font-bold text-white">{v.title}</h3>
                          {v.archived_at && <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/[0.08] text-neutral-400">закрыта</span>}
                        </div>
                        <p className="text-sm text-neutral-400 mt-1">
                          {formatSalary(v.salary_min, v.salary_max, v.salary_currency)}
                          {v.city ? ` · ${v.city}` : ""}{v.is_remote ? " · удалённо" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Link href={`/vacancy/${v.id}`} title="Открыть страницу вакансии" aria-label="Открыть страницу вакансии"
                          className="w-10 h-10 inline-flex items-center justify-center rounded-full border border-white/12 text-neutral-400 hover:text-white hover:border-white/30"><Eye className="w-4 h-4" /></Link>
                        <button onClick={() => openForm(v)} title="Редактировать" aria-label="Редактировать"
                          className="w-10 h-10 inline-flex items-center justify-center rounded-full border border-white/12 text-neutral-400 hover:text-white hover:border-white/30"><Pencil className="w-4 h-4" /></button>
                        {v.archived_at ? (
                          <button onClick={() => setArchived(v, false)}
                            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-white/12 text-sm text-neutral-300 hover:text-white hover:border-white/30">
                            <RotateCcw className="w-3.5 h-3.5" /> Открыть снова
                          </button>
                        ) : (
                          <button onClick={() => setArchived(v, true)}
                            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-white/12 text-sm text-neutral-300 hover:text-red-300 hover:border-red-400/40">
                            <Archive className="w-3.5 h-3.5" /> Закрыть
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2 text-sm" aria-label="Воронка вакансии">
                      {funnel.map((f, i) => (
                        <div key={f.label} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-3">
                          <span className="text-neutral-400">{f.label}</span>
                          <span className="h-2.5 rounded-r-md bg-white/[0.06] overflow-hidden">
                            <span className={`bar-grow block h-full rounded-r-md ${f.color}`}
                              style={{ width: `${Math.max(f.value ? 2 : 0, (f.value / top) * 100)}%`, animationDelay: `${i * 0.15}s` }} />
                          </span>
                          <span className="text-right tabular-nums" title={`${f.value} ${plural(f.value, f.word)}`}>{f.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Отклики */}
        {activeTab === "applications" && (
          applications.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-white/15 rounded-3xl">
              <Briefcase className="w-10 h-10 mx-auto text-neutral-600 mb-3" />
              <p className="text-neutral-400 text-sm font-medium">Пока нет откликов</p>
              <p className="text-neutral-500 text-xs mt-1">Опубликуйте вакансию, чтобы получать отклики через Smart Apply</p>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label="Сортировка откликов" className="inline-flex gap-1 p-1 rounded-full bg-white/[0.06] text-sm">
                  {([["match", "По совпадению"], ["new", "Сначала новые"]] as const).map(([id, label]) => (
                    <button key={id} onClick={() => setSortBy(id)} aria-pressed={sortBy === id}
                      className={`px-4 py-1.5 rounded-full transition-colors ${sortBy === id ? "bg-white/[0.14] text-white" : "text-neutral-400 hover:text-white"}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-neutral-500">Порядок зависит только от совпадения с вакансией — не от оплаты</p>
              </div>
              {(sortBy === "match"
                ? [...applications].sort((a, b) => (matches[b.id]?.score ?? -1) - (matches[a.id]?.score ?? -1))
                : applications
              ).map(app => (
                <div key={app.id} className="glass rounded-3xl p-5 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    {matches[app.id] && (
                      <MatchRing value={matches[app.id].score} size={64} stroke={matches[app.id].score >= 70 ? "#5EEAD4" : "#818CF8"} />
                    )}
                    <div className="flex-1 min-w-[14rem]">
                      <p className="font-semibold text-white flex flex-wrap items-center gap-2">
                        {app.profiles?.name || "Без имени"}
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                          app.status === "interview_scheduled" ? "bg-teal-300/15 text-teal-200"
                            : app.status === "rejected" ? "bg-white/[0.08] text-neutral-400"
                            : "bg-amber-300/15 text-amber-200"
                        }`}>
                          {STATUS_LABELS[app.status] ?? app.status}
                        </span>
                      </p>
                      <p className="text-sm text-neutral-400 mt-1">
                        {app.vacancies.title}
                        {app.profiles?.skills?.length ? ` · ${app.profiles.skills.slice(0, 6).join(", ")}` : ""}
                      </p>
                    </div>
                  </div>

                  {matches[app.id] && (matches[app.id].matched.length + matches[app.id].related.length + matches[app.id].missing.length > 0) && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {matches[app.id].matched.map(s => <span key={s} className="px-2.5 py-1 rounded-full bg-teal-300/15 text-teal-200">{s} ✓</span>)}
                      {matches[app.id].related.map(r => (
                        <span key={r.skill} title="Засчитано наполовину: у кандидата смежный опыт" className="px-2.5 py-1 rounded-full bg-sky-400/10 text-sky-200">{r.skill} ≈ {r.via}</span>
                      ))}
                      {matches[app.id].missing.map(s => <span key={s} className="px-2.5 py-1 rounded-full bg-amber-300/10 text-amber-200">нет {s}</span>)}
                    </div>
                  )}

                  <BlitzAnswers applicationId={app.id} answers={app.blitz_answers ?? []} summary={app.blitz_summary} />

                  <div className="bg-[#0B0F19] border border-white/10 rounded-2xl p-4 text-sm text-neutral-300 leading-relaxed whitespace-pre-line">
                    <p className="text-xs text-neutral-500 mb-2">Сопроводительное письмо</p>
                    {app.cover_letter || "Письмо не сохранено"}
                  </div>

                  {app.hr_message && reply?.appId !== app.id && (
                    <div className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-neutral-400">
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
                                className={`px-3 py-1 rounded-full text-xs border transition-colors ${active ? "bg-teal-300 border-teal-300 text-neutral-950" : "border-white/15 text-neutral-300 hover:border-white/30"}`}>
                                {reason.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <textarea value={reply.text} maxLength={2000} rows={4}
                        onChange={e => setReply({ ...reply, text: e.target.value })}
                        className={`${inputClass} leading-relaxed resize-y`} />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setReply(null)} className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white">Отмена</button>
                        <button onClick={sendReply} disabled={replying}
                          className="h-10 px-4 bg-teal-300 hover:bg-teal-200 text-neutral-950 rounded-full text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
                          {replying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Отправить
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-white/10">
                    {app.profiles?.resume_path && (
                      <button onClick={() => openResume(app.profiles!.resume_path!)}
                        className="mr-auto h-11 px-4 rounded-full border border-white/12 text-neutral-200 hover:border-white/30 text-sm transition-colors flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" /> Резюме (PDF)
                      </button>
                    )}
                    <button onClick={() => setReply({ appId: app.id, status: "rejected", text: REPLY_TEMPLATES.rejected(app.vacancies.title) })}
                      className="h-11 px-4 rounded-full border border-white/15 text-neutral-300 hover:text-red-300 hover:border-red-400/40 text-sm transition-colors flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5" /> Отказать
                    </button>
                    <button onClick={() => setReply({ appId: app.id, status: "interview_scheduled", text: REPLY_TEMPLATES.interview_scheduled(app.vacancies.title) })}
                      className="h-11 px-5 rounded-full bg-teal-300 hover:bg-teal-200 text-neutral-950 text-sm font-semibold transition-colors flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Пригласить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
