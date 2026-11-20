"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppBar from "@/components/AppBar";
import { Briefcase, Loader2, Plus } from "lucide-react";
import { toMatch, type Match } from "@/lib/matching";
import type { VacancyDraft } from "@/lib/vacancy-draft";
import EmployerReviews from "@/components/EmployerReviews";
import { fetchSalaryBenchmarks, type SalaryBenchmark } from "@/lib/salary";
import { requestScreening } from "@/components/ScreeningVerdict";
import type { Screening } from "@/lib/screening";
import UpcomingInterviews from "@/components/UpcomingInterviews";
import { rejectAll, rejectNotice } from "@/lib/bulk-reject";
import { loadErrorText } from "@/lib/load-errors";
import { supabase, getUserRole } from "@/lib/supabase";
import type { Vacancy } from "@/lib/vacancies";
import {
  bulkRejections, EMPTY_FORM, formFromVacancy, formWithDraft, isWaiting, sortApplications, vacancyFields,
  type Application, type SortBy, type Tab, type VacancyForm,
} from "@/lib/employer";
import ApplicationCard, { type Reply } from "@/components/employer/ApplicationCard";
import ApplicationsToolbar from "@/components/employer/ApplicationsToolbar";
import BulkReject from "@/components/employer/BulkReject";
import EmployerVacancyCard from "@/components/employer/EmployerVacancyCard";
import VacancyFormPanel from "@/components/employer/VacancyFormPanel";

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
  const [sortBy, setSortBy] = useState<SortBy>("match");
  // ИИ-вердикты по откликам и пакетный разбор новых
  const [screenings, setScreenings] = useState<Record<string, Screening>>({});
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  // Массовый отказ: выбранные отклики и причина
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ reason: string | null } | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  // Справочник зарплат для сравнения вакансий с рынком
  const [benchmarks, setBenchmarks] = useState<SalaryBenchmark[]>([]);
  // Ответ кандидату: какой отклик, какой статус и текст письма
  const [reply, setReply] = useState<Reply | null>(null);
  const [replying, setReplying] = useState(false);

  // ИИ-помощник: заметки работодателя → черновик вакансии в форме
  const [notes, setNotes] = useState("");
  const [drafting, setDrafting] = useState(false);

  const loadData = useCallback(async (currentUser: User) => {
    const [{ data: prof, error: profError }, { data: apps, error: appsError }, { data: own, error: ownError }] = await Promise.all([
      supabase.from("profiles").select("name").eq("id", currentUser.id).maybeSingle(),
      supabase
        .from("applications")
        .select("id, candidate_id, status, hr_message, cover_letter, created_at, blitz_answers, blitz_summary, vacancies!inner (id, title, employer_id), profiles (name, skills, has_resume), conversations (id)")
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

    fetchSalaryBenchmarks().then(setBenchmarks);
    const [{ data: scored, error: scoredError }, { data: screened, error: screenedError }] = await Promise.all([
      supabase.rpc("my_application_matches"),
      supabase.from("application_screenings").select("application_id, screening"),
    ]);
    setScreenings(Object.fromEntries((screened ?? []).map(r => [r.application_id, r.screening as unknown as Screening])));
    setMatches(Object.fromEntries((scored ?? []).map(r => [r.application_id, toMatch(r)])));

    // Работодатель открыл кабинет — кандидаты видят, что отклик просмотрен.
    // На экране оставляем «Новый отклик», чтобы было видно, что пришло с прошлого раза.
    const unseen = loaded.filter(a => a.status === "new").map(a => a.id);
    const { error: viewedError } = unseen.length
      ? await supabase.from("applications").update({ status: "viewed" }).in("id", unseen)
      : { error: null };
    return loadErrorText([
      ["профиль", profError], ["отклики", appsError], ["вакансии", ownError],
      ["совпадения", scoredError], ["ИИ-разбор", screenedError], ["отметку «просмотрен»", viewedError],
    ]);
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
      const loadError = await loadData(user);
      if (loadError) setNotice({ kind: "error", text: loadError });
      setLoading(false);
    })();
  }, [router, loadData]);

  function openForm(vacancy?: Vacancy) {
    setNotice(null);
    if (vacancy) {
      setEditingId(vacancy.id);
      setForm(formFromVacancy(vacancy));
    } else {
      setEditingId(null);
      setForm(EMPTY_FORM);
    }
    setActiveTab("form");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const result = vacancyFields(form, companyName);
    if ("error" in result) {
      setNotice({ kind: "error", text: result.error });
      return;
    }
    setSaving(true);
    setNotice(null);

    const { fields } = result;
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
    const loadError = await loadData(user);
    const saved = editingId ? "Изменения сохранены." : "Вакансия опубликована.";
    setNotice(loadError ? { kind: "error", text: `${saved} ${loadError}` } : { kind: "ok", text: saved });
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
      setForm(prev => formWithDraft(prev, draft));
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
    setNotice({ kind: "ok", text: reply.status === "interview_scheduled" ? "Приглашение отправлено. Предложите время в чате (кнопка «Написать» → значок календаря) — кандидат выберет удобный вариант." : "Ответ отправлен кандидату." });
    setReply(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-teal-300" />
      </div>
    );
  }

  const waitingIds = applications.filter(isWaiting).map(a => a.id);
  const weakIds = waitingIds.filter(id => screenings[id]?.fit === "weak");
  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Каждый получает вежливый отказ с названием своей вакансии и, если выбрана, причиной
  async function sendBulkReject() {
    if (!bulk) return;
    const letters = bulkRejections(applications, selected, bulk.reason);
    setBulkSending(true);
    const result = await rejectAll(letters, async (ids, message) => {
      const { data, error } = await supabase.from("applications")
        .update({ status: "rejected", hr_message: message, hr_replied_at: new Date().toISOString() })
        .in("id", ids)
        .select("id");
      return { updated: (data ?? []).map(r => r.id), error: error?.message ?? null };
    });
    setBulkSending(false);
    const { done, failed } = result;
    setApplications(prev => prev.map(a => done[a.id] ? { ...a, status: "rejected", hr_message: done[a.id] } : a));
    // Неотправленные остаются выбранными, панель открыта — можно повторить
    setSelected(new Set(failed.flatMap(f => f.ids)));
    if (!failed.length) setBulk(null);
    setNotice(rejectNotice(result));
  }

  // Пакетный разбор: отклики без вердикта, ждущие ответа, — по одному, чтобы не упереться в лимиты
  const unscreened = applications.filter(a => !screenings[a.id] && isWaiting(a));
  async function screenAll() {
    const queue = unscreened.slice(0, 15);
    setBatch({ done: 0, total: queue.length });
    for (const [i, app] of queue.entries()) {
      const { screening, error } = await requestScreening(app.id);
      if (error) {
        setNotice({ kind: "error", text: error });
        break;
      }
      if (screening) setScreenings(all => ({ ...all, [app.id]: screening }));
      setBatch({ done: i + 1, total: queue.length });
    }
    setBatch(null);
    setSortBy("ai");
  }

  const openVacancies = vacancies.filter(v => !v.archived_at).length;
  const tabClass = (tab: Tab) =>
    `px-4 py-2 rounded-full text-sm transition-colors ${
      activeTab === tab ? "lg lg-on" : "lg text-neutral-400 hover:text-white"
    }`;

  return (
    <>
    <AppBar role="employer" />
    <div className="min-h-screen text-neutral-100 font-sans p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-bold">Кабинет работодателя</h1>
            </div>
            <p className="text-sm text-neutral-400">
              Компания: {companyName || <Link href="/profile" className="text-teal-300 hover:underline">укажите в профиле</Link>}
            </p>
          </div>
          <span className="flex-1" />
          <button
            onClick={() => openForm()}
            className="lg lg-accent inline-flex items-center gap-2 h-11 px-5 rounded-full text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Новая вакансия
          </button>
        </div>

        <UpcomingInterviews />

        <div role="tablist" aria-label="Разделы кабинета" className="neu-in inline-flex gap-1 p-1 rounded-full">
          <button role="tab" aria-selected={activeTab === "applications"} onClick={() => setActiveTab("applications")} className={tabClass("applications")}>
            Отклики · {applications.length}
          </button>
          <button role="tab" aria-selected={activeTab === "vacancies"} onClick={() => setActiveTab("vacancies")} className={tabClass("vacancies")}>
            Вакансии · {openVacancies}
          </button>
          <button role="tab" aria-selected={activeTab === "reviews"} onClick={() => setActiveTab("reviews")} className={tabClass("reviews")}>
            Отзывы
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
          <VacancyFormPanel editingId={editingId} form={form} setForm={setForm} notes={notes} setNotes={setNotes}
            drafting={drafting} onDraft={draftWithAi} saving={saving} onSubmit={handleSubmit}
            onCancelEdit={() => { setEditingId(null); setActiveTab("vacancies"); }} />
        )}

        {/* Мои вакансии */}
        {activeTab === "reviews" && <EmployerReviews companyName={companyName} />}

        {activeTab === "vacancies" && (
          vacancies.length === 0 ? (
            <div className="neu-sub text-center py-20 rounded-3xl">
              <Briefcase className="w-10 h-10 mx-auto text-neutral-600 mb-3" />
              <p className="text-neutral-400 text-sm font-medium">У вас пока нет вакансий</p>
              <button onClick={() => openForm()} className="mt-3 text-sm text-teal-300 hover:underline">Опубликовать первую</button>
            </div>
          ) : (
            <div className="grid gap-3">
              {vacancies.map(v => (
                <EmployerVacancyCard key={v.id} vacancy={v} forVacancy={applications.filter(a => a.vacancies.id === v.id)}
                  matches={matches} benchmarks={benchmarks} onEdit={openForm} onArchive={setArchived} />
              ))}
            </div>
          )
        )}

        {/* Отклики */}
        {activeTab === "applications" && (
          applications.length === 0 ? (
            <div className="neu-sub text-center py-20 rounded-3xl">
              <Briefcase className="w-10 h-10 mx-auto text-neutral-600 mb-3" />
              <p className="text-neutral-400 text-sm font-medium">Пока нет откликов</p>
              <p className="text-neutral-500 text-xs mt-1">Опубликуйте вакансию, чтобы получать отклики через Smart Apply</p>
            </div>
          ) : (
            <div className="grid gap-4">
              <ApplicationsToolbar sortBy={sortBy} setSortBy={setSortBy} unscreenedCount={unscreened.length} batch={batch} onScreenAll={screenAll} />

              <BulkReject waitingIds={waitingIds} weakIds={weakIds} selected={selected} setSelected={setSelected}
                bulk={bulk} setBulk={setBulk} bulkSending={bulkSending} onSend={sendBulkReject} />
              {sortApplications(applications, sortBy, matches, screenings).map(app => (
                <ApplicationCard key={app.id} app={app} match={matches[app.id]} screening={screenings[app.id]}
                  selected={selected.has(app.id)} onToggleSelected={toggleSelected}
                  reply={reply} setReply={setReply} replying={replying} onSendReply={sendReply} onOpenResume={openResume}
                  onScreeningChange={(id, sc) => setScreenings(all => ({ ...all, [id]: sc }))} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
    </>
  );
}
