"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Archive, ArrowLeft, Briefcase, CheckCircle2, Eye, Loader2, Pencil, PlusCircle, RotateCcw, XCircle,
} from "lucide-react";
import { supabase, getUserRole } from "@/lib/supabase";
import { formatSalary, plural, type Vacancy } from "@/lib/vacancies";

type Tab = "applications" | "vacancies" | "form";

interface Application {
  id: string;
  status: string;
  cover_letter: string | null;
  created_at: string;
  vacancies: { id: string; title: string; employer_id: string };
  profiles: { name: string | null; skills: string[] | null } | null;
}

interface VacancyForm {
  title: string;
  description: string;
  salaryMin: string;
  salaryMax: string;
  currency: string;
  city: string;
  isRemote: boolean;
}

const EMPTY_FORM: VacancyForm = {
  title: "", description: "", salaryMin: "", salaryMax: "", currency: "RUB", city: "", isRemote: false,
};

const STATUS_LABELS: Record<string, string> = {
  new: "Новый отклик",
  viewed: "Просмотрен",
  interview_scheduled: "Собеседование назначено",
  rejected: "Отклонено",
};

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

  const loadData = useCallback(async (currentUser: User) => {
    const [{ data: prof }, { data: apps }, { data: own }] = await Promise.all([
      supabase.from("profiles").select("name").eq("id", currentUser.id).maybeSingle(),
      supabase
        .from("applications")
        .select("id, status, cover_letter, created_at, vacancies!inner (id, title, employer_id), profiles (name, skills)")
        .eq("vacancies.employer_id", currentUser.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("vacancies")
        .select("*")
        .eq("employer_id", currentUser.id)
        .order("created_at", { ascending: false }),
    ]);
    setCompanyName(prof?.name || null);
    setApplications((apps ?? []) as unknown as Application[]);
    setVacancies((own ?? []) as Vacancy[]);
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

  async function updateStatus(appId: string, status: string) {
    const { error } = await supabase
      .from("applications")
      .update({ status, hr_replied_at: new Date().toISOString() })
      .eq("id", appId);
    if (error) {
      setNotice({ kind: "error", text: "Не удалось обновить статус: " + error.message });
      return;
    }
    setApplications(prev => prev.map(app => app.id === appId ? { ...app, status } : app));
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
                const count = applications.filter(a => a.vacancies.id === v.id).length;
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
                        {` · ${count} ${plural(count, ["отклик", "отклика", "откликов"])}`}
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
              {applications.map(app => (
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

                  <div className="bg-neutral-950 border border-neutral-800/80 rounded-xl p-4 text-sm text-neutral-300 leading-relaxed whitespace-pre-line">
                    <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Сопроводительное письмо</p>
                    {app.cover_letter || "Письмо не сохранено"}
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-800/60">
                    <button onClick={() => updateStatus(app.id, "rejected")}
                      className="px-3 py-1.5 bg-neutral-800 hover:bg-red-950/40 text-neutral-300 hover:text-red-400 rounded-lg text-xs font-medium border border-neutral-700 transition-colors flex items-center gap-1.5">
                      <XCircle className="w-3.5 h-3.5" /> Отказать
                    </button>
                    <button onClick={() => updateStatus(app.id, "interview_scheduled")}
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
