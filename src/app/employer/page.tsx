"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2, PlusCircle, CheckCircle2, XCircle, ArrowLeft, Building2 } from "lucide-react";
import Link from "next/link";

export default function EmployerDashboard() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"applications" | "create">("applications");
  
  // Состояния для формы создания вакансии
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [city, setCity] = useState("");
  const [isRemote, setIsRemote] = useState(false);
  const [creating, setCreating] = useState(false);

  const router = useRouter();

  useEffect(() => {
    checkUserAndFetchData();
  }, []);

  async function checkUserAndFetchData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    setUser(user);

    // Проверяем роль
    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (prof) setProfile(prof);

    // Получаем отклики на вакансии этого работодателя
    const { data: apps } = await supabase
      .from("applications")
      .select(`
        id,
        status,
        cover_letter,
        created_at,
        vacancies!inner (
          id,
          title,
          employer_id
        ),
        profiles (
          name,
          skills
        )
      `)
      .eq("vacancies.employer_id", user.id);

    if (apps) {
      setApplications(apps);
    }
    setLoading(false);
  }

  async function handleCreateVacancy(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setCreating(true);

    const payload = {
      title,
      description,
      salary_min: salaryMin ? parseInt(salaryMin) : null,
      salary_max: salaryMax ? parseInt(salaryMax) : null,
      city: city || null,
      is_remote: isRemote,
      source_type: "internal", // Помечаем как внутреннюю вакансию платформы
      employer_id: user.id,
      ranking_weight: 1.5 // Внутренние вакансии ранжируются выше
    };

    const { error } = await supabase.from("vacancies").insert(payload);

    if (error) {
      alert("Ошибка при публикации: " + error.message);
    } else {
      alert("Вакансия успешно опубликована на платформе!");
      setTitle("");
      setDescription("");
      setSalaryMin("");
      setSalaryMax("");
      setCity("");
      setIsRemote(false);
      setActiveTab("applications");
    }
    setCreating(false);
  }

  async function updateStatus(appId: string, newStatus: string) {
    const updatePayload: any = { status: newStatus };
    if (newStatus === "interview_scheduled" || newStatus === "rejected") {
      updatePayload.hr_replied_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("applications")
      .update(updatePayload)
      .eq("id", appId);

    if (error) {
      alert("Ошибка обновления статуса: " + error.message);
    } else {
      setApplications(prev => prev.map(app => app.id === appId ? { ...app, status: newStatus } : app));
    }
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
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Хедер кабинета */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="p-2 bg-neutral-900 border border-neutral-800 rounded-xl hover:bg-neutral-800 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                Кабинет работодателя
                <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-normal">
                  SLA & Pay-per-Interview
                </span>
              </h1>
              <p className="text-xs text-neutral-400 mt-0.5">Организация: {profile?.name || "Не указано"}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("applications")}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === "applications" ? "bg-neutral-800 text-white border border-neutral-700" : "text-neutral-400 hover:text-white"
              }`}
            >
              Отклики ({applications.length})
            </button>
            <button
              onClick={() => setActiveTab("create")}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                activeTab === "create" ? "bg-blue-600 text-white" : "bg-neutral-900 border border-neutral-800 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              <PlusCircle className="w-4 h-4" /> Опубликовать вакансию
            </button>
          </div>
        </div>

        {/* Вкладка 1: Форма публикации */}
        {activeTab === "create" && (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-2xl p-6 sm:p-8 space-y-6">
            <h2 className="text-lg font-bold">Публикация вакансии прямого найма</h2>
            <form onSubmit={handleCreateVacancy} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Название должности</label>
                <input
                  required
                  type="text"
                  placeholder="Например: Senior Java Developer"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Зарплата от (₽)</label>
                  <input
                    type="number"
                    placeholder="150000"
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                    className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Зарплата до (₽)</label>
                  <input
                    type="number"
                    placeholder="250000"
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value)}
                    className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div>
                  <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Город</label>
                  <input
                    type="text"
                    placeholder="Москва / Санкт-Петербург"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="pt-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isRemote}
                      onChange={(e) => setIsRemote(e.target.checked)}
                      className="w-5 h-5 rounded bg-neutral-950 border-neutral-800 text-blue-600 focus:ring-0"
                    />
                    <span className="text-sm text-neutral-300">Возможна удаленная работа</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Описание обязанностей и требований</label>
                <textarea
                  required
                  rows={5}
                  placeholder="Опишите стек, проект и задачи кандидата..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-100 focus:outline-none focus:border-blue-500 leading-relaxed resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={creating}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : "Опубликовать на бирже"}
              </button>
            </form>
          </div>
        )}

        {/* Вкладка 2: Просмотр откликов соискателей */}
        {activeTab === "applications" && (
          <>
            {applications.length === 0 ? (
              <div className="text-center py-20 bg-neutral-900/30 border border-dashed border-neutral-800 rounded-2xl">
                <Briefcase className="w-10 h-10 mx-auto text-neutral-700 mb-3" />
                <p className="text-neutral-400 text-sm font-medium">Пока нет входящих откликов</p>
                <p className="text-neutral-500 text-xs mt-1">Опубликуйте вакансию, чтобы получать отклики со Smart Apply</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {applications.map((app) => (
                  <div key={app.id} className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6 space-y-4">
                    <div className="flex flex-col sm:flex-row justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-bold text-white">{app.vacancies.title}</h3>
                        <p className="text-xs text-neutral-400 mt-0.5">Кандидат: <span className="text-neutral-200 font-semibold">{app.profiles?.name || "Аноним"}</span></p>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-3 py-1 rounded-full font-medium border ${
                          app.status === 'new' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                          app.status === 'interview_scheduled' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                          'bg-neutral-800 text-neutral-400 border-neutral-700'
                        }`}>
                          {app.status === 'new' ? 'Ожидает ответа (SLA)' :
                           app.status === 'interview_scheduled' ? 'Собеседование назначено (Pay-per-Interview)' : 'Отклонено'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-neutral-950 border border-neutral-800/80 rounded-xl p-4 text-sm text-neutral-300 leading-relaxed">
                      <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Сопроводительное письмо (Smart Apply):</p>
                      {app.cover_letter || "Письмо не было сохранено"}
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-800/60">
                      <button
                        onClick={() => updateStatus(app.id, 'rejected')}
                        className="px-3 py-1.5 bg-neutral-800 hover:bg-red-950/40 text-neutral-300 hover:text-red-400 rounded-lg text-xs font-medium border border-neutral-700 transition-colors flex items-center gap-1.5"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Отказать
                      </button>

                      <button
                        onClick={() => updateStatus(app.id, 'interview_scheduled')}
                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 shadow-lg shadow-emerald-600/20"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Назначить собеседование
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}