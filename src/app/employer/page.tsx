"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Archive, ArrowLeft, Briefcase, CheckCircle2, Eye, FileText, Loader2, Pencil, PlusCircle, RotateCcw, Send, Sparkles, Target, XCircle,
} from "lucide-react";
import { matchTone, toMatch, type Match } from "@/lib/matching";
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
}

const EMPTY_FORM: VacancyForm = {
  title: "", description: "", salaryMin: "", salaryMax: "", currency: "RUB", city: "", isRemote: false, stack: "",
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
  "w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500";
const labelClass = "block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2";

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
  const [sortBy, setSortBy] = useState<"new" | "match">("new");
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
        .select("id, status, hr_message, cover_letter, created_at, vacancies!inner (id, title, employer_id), profiles (name, skills, resume_path)")
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
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const openVacancies = vacancies.filter(v => !v.archived_at).length;
  const tabClass = (tab: Tab) =>
    `px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
      activeTab === tab ? "bg-neutral-800 text-white border border-neutral-700" : "text-neutral-400 hover:text-white"
    }`;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 bg-neutral-900 border border-neutral-800 rounded-xl hover:bg-neutral-800 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-bold">Кабинет работодателя</h1>
              <p className="text-xs text-neutral-400 mt-0.5">
                Компания: {companyName || <Link href="/profile" className="text-blue-400 hover:underline">укажите в профиле</Link>}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setActiveTab("applications")} className={tabClass("applications")}>
              Отклики ({applications.length})
            </button>
            <button onClick={() => setActiveTab("vacancies")} className={tabClass("vacancies")}>
              Мои вакансии ({openVacancies})
            </button>
            <button
              onClick={() => openForm()}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                activeTab === "form" && !editingId ? "bg-blue-600 text-white" : "bg-neutral-900 border border-neutral-800 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              <PlusCircle className="w-4 h-4" /> Опубликовать
            </button>
          </div>
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
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-6 sm:p-8 space-y-6">
            <h2 className="text-lg font-bold">{editingId ? "Редактирование вакансии" : "Новая вакансия"}</h2>
            {!editingId && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-4 space-y-3">
                <p className="text-sm text-neutral-300 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-400" /> Опишите вакансию парой фраз — ИИ напишет полный текст
                </p>
                <textarea rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Ищем мидл-бэкендера на Python в финтех, Django + Postgres, удалёнка, 250–300к"
                  className={`${inputClass} resize-y`} />
                <button type="button" onClick={draftWithAi} disabled={drafting || notes.trim().length < 15}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50">
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
                    className="w-5 h-5 rounded bg-neutral-950 border-neutral-800 text-blue-600 focus:ring-0" />
                  <span className="text-sm text-neutral-300">Возможна удалённая работа</span>
                </label>
              </div>

              <div>
                <label className={labelClass}>Технологии (через запятую)</label>
                <input type="text" placeholder="Python, Django, PostgreSQL" value={form.stack}
                  onChange={e => setForm({ ...form, stack: e.target.value })} className={inputClass} />
              </div>

              <div>
                <label className={labelClass}>Обязанности и требования</label>
                <textarea required rows={6} placeholder="Опишите стек, проект и задачи кандидата..."
                  value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  className={`${inputClass} leading-relaxed resize-y`} />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button type="submit" disabled={saving}
                  className="flex-1 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : editingId ? "Сохранить изменения" : "Опубликовать"}
                </button>
                {editingId && (
                  <button type="button" onClick={() => { setEditingId(null); setActiveTab("vacancies"); }}
                    className="px-6 py-3.5 bg-neutral-900 border border-neutral-800 rounded-xl text-sm text-neutral-300 hover:bg-neutral-800">
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
            <div className="text-center py-20 bg-neutral-900/30 border border-dashed border-neutral-800 rounded-2xl">
              <Briefcase className="w-10 h-10 mx-auto text-neutral-700 mb-3" />
              <p className="text-neutral-400 text-sm font-medium">У вас пока нет вакансий</p>
              <button onClick={() => openForm()} className="mt-3 text-sm text-blue-400 hover:underline">Опубликовать первую</button>
            </div>
          ) : (
            <div className="grid gap-3">
              {vacancies.map(v => {
                const forVacancy = applications.filter(a => a.vacancies.id === v.id);
                const count = forVacancy.length;
                const invited = forVacancy.filter(a => a.status === "interview_scheduled").length;
                return (
                  <div key={v.id} className={`bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 ${v.archived_at ? "opacity-60" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white truncate">{v.title}</h3>
                        {v.archived_at && <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">закрыта</span>}
                      </div>
                      <p className="text-xs text-neutral-400 mt-1">
                        {formatSalary(v.salary_min, v.salary_max, v.salary_currency)}
                        {v.city ? ` · ${v.city}` : ""}{v.is_remote ? " · удалённо" : ""}
                      </p>
                      <p className="text-xs text-neutral-500 mt-1" title="Воронка вакансии">
                        {v.views_count ?? 0} {plural(v.views_count ?? 0, ["просмотр", "просмотра", "просмотров"])}
                        {" → "}{count} {plural(count, ["отклик", "отклика", "откликов"])}
                        {" → "}{invited} {plural(invited, ["приглашение", "приглашения", "приглашений"])}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/vacancy/${v.id}`} title="Открыть страницу вакансии"
                        className="p-2 rounded-lg border border-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-800"><Eye className="w-4 h-4" /></Link>
                      <button onClick={() => openForm(v)} title="Редактировать"
                        className="p-2 rounded-lg border border-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-800"><Pencil className="w-4 h-4" /></button>
                      {v.archived_at ? (
                        <button onClick={() => setArchived(v, false)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-800 text-xs text-neutral-300 hover:bg-neutral-800">
                          <RotateCcw className="w-3.5 h-3.5" /> Открыть снова
                        </button>
                      ) : (
                        <button onClick={() => setArchived(v, true)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-neutral-800 text-xs text-neutral-300 hover:text-red-300 hover:bg-red-950/30">
                          <Archive className="w-3.5 h-3.5" /> Закрыть
                        </button>
                      )}
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
            <div className="text-center py-20 bg-neutral-900/30 border border-dashed border-neutral-800 rounded-2xl">
              <Briefcase className="w-10 h-10 mx-auto text-neutral-700 mb-3" />
              <p className="text-neutral-400 text-sm font-medium">Пока нет откликов</p>
              <p className="text-neutral-500 text-xs mt-1">Опубликуйте вакансию, чтобы получать отклики через Smart Apply</p>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                Сортировка:
                {([["new", "Сначала новые"], ["match", "По совпадению"]] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setSortBy(id)} aria-pressed={sortBy === id}
                    className={`px-3 py-1.5 rounded-lg border transition-colors ${sortBy === id ? "bg-neutral-800 border-neutral-700 text-white" : "border-neutral-800 hover:bg-neutral-900"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {(sortBy === "match"
                ? [...applications].sort((a, b) => (matches[b.id]?.score ?? -1) - (matches[a.id]?.score ?? -1))
                : applications
              ).map(app => (
                <div key={app.id} className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-bold text-white">{app.vacancies.title}</h3>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Кандидат: <span className="text-neutral-200 font-semibold">{app.profiles?.name || "Без имени"}</span>
                        {app.profiles?.skills?.length ? ` · ${app.profiles.skills.join(", ")}` : ""}
                      </p>
                    </div>
                    <span className={`text-xs px-3 py-1 h-fit rounded-full font-medium border ${
                      app.status === "interview_scheduled" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : app.status === "rejected" ? "bg-neutral-800 text-neutral-400 border-neutral-700"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    }`}>
                      {STATUS_LABELS[app.status] ?? app.status}
                    </span>
                  </div>

                  {matches[app.id] && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-semibold ${matchTone(matches[app.id].score)}`}>
                        <Target className="w-3.5 h-3.5" />Совпадение {matches[app.id].score}%
                      </span>
                      {matches[app.id].matched.length > 0 && <span>Есть: <span className="text-emerald-400">{matches[app.id].matched.join(", ")}</span></span>}
                      {matches[app.id].related.length > 0 && (
                        <span title="Засчитано наполовину: у кандидата смежный опыт">
                          Смежное: <span className="text-sky-300">{matches[app.id].related.map(r => `${r.skill} (есть ${r.via})`).join(", ")}</span>
                        </span>
                      )}
                      {matches[app.id].missing.length > 0 && <span>Нет: <span className="text-amber-300">{matches[app.id].missing.join(", ")}</span></span>}
                    </p>
                  )}

                  <div className="bg-neutral-950 border border-neutral-800/80 rounded-xl p-4 text-sm text-neutral-300 leading-relaxed whitespace-pre-line">
                    <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Сопроводительное письмо</p>
                    {app.cover_letter || "Письмо не сохранено"}
                  </div>

                  {app.hr_message && reply?.appId !== app.id && (
                    <div className="rounded-xl border border-neutral-800 px-4 py-3 text-sm text-neutral-400">
                      <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">Ваш ответ</p>
                      <p className="whitespace-pre-line">{app.hr_message}</p>
                    </div>
                  )}

                  {reply?.appId === app.id && (
                    <div className="space-y-3 rounded-xl border border-blue-500/30 bg-blue-950/20 p-4">
                      <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">
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
                                className={`px-3 py-1 rounded-lg text-xs border transition-colors ${active ? "bg-blue-600 border-blue-500 text-white" : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"}`}>
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
                          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-50">
                          {replying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Отправить
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-800/60">
                    {app.profiles?.resume_path && (
                      <button onClick={() => openResume(app.profiles!.resume_path!)}
                        className="mr-auto px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-xs font-medium border border-neutral-700 transition-colors flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" /> Резюме (PDF)
                      </button>
                    )}
                    <button onClick={() => setReply({ appId: app.id, status: "rejected", text: REPLY_TEMPLATES.rejected(app.vacancies.title) })}
                      className="px-3 py-1.5 bg-neutral-800 hover:bg-red-950/40 text-neutral-300 hover:text-red-400 rounded-lg text-xs font-medium border border-neutral-700 transition-colors flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5" /> Отказать
                    </button>
                    <button onClick={() => setReply({ appId: app.id, status: "interview_scheduled", text: REPLY_TEMPLATES.interview_scheduled(app.vacancies.title) })}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-lg shadow-emerald-600/20">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Пригласить на собеседование
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
