import type { BlitzAnswer } from "@/components/BlitzAnswers";
import type { Match } from "@/lib/matching";
import { FIT_ORDER, type Screening } from "@/lib/screening";
import type { VacancyDraft } from "@/lib/vacancy-draft";
import { discriminationFlags, type DiscriminationFlag } from "@/lib/discrimination";
import type { Vacancy } from "@/lib/vacancies";

/** Чистая логика кабинета работодателя: форма вакансии, отклики, отказы. Без React и без запросов. */

export type Tab = "applications" | "vacancies" | "reviews" | "form";
export type SortBy = "new" | "match" | "ai";
export type ReplyStatus = "interview_scheduled" | "rejected";

export interface Application {
  id: string;
  status: string;
  hr_message: string | null;
  cover_letter: string | null;
  created_at: string;
  blitz_answers: BlitzAnswer[];
  blitz_summary: string | null;
  vacancies: { id: string; title: string; employer_id: string };
  profiles: { name: string | null; skills: string[] | null; resume_path: string | null } | null;
  /** Чат с кандидатом (открывается откликом) */
  conversations: { id: string } | null;
}

export interface VacancyForm {
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

export const EMPTY_FORM: VacancyForm = {
  title: "", description: "", salaryMin: "", salaryMax: "", currency: "RUB", city: "", isRemote: false, stack: "", questions: ["", "", ""],
};

export const STATUS_LABELS: Record<string, string> = {
  new: "Новый отклик",
  viewed: "Просмотрен",
  interview_scheduled: "Собеседование назначено",
  rejected: "Отклонено",
};

// Черновики ответа кандидату; работодатель правит их перед отправкой
export const REPLY_TEMPLATES: Record<ReplyStatus, (vacancy: string) => string> = {
  interview_scheduled: vacancy =>
    `Здравствуйте! Спасибо за отклик на вакансию «${vacancy}». Ваш опыт нам интересен — приглашаем на собеседование. ` +
    "Напишите, пожалуйста, когда вам удобно поговорить на этой неделе.",
  rejected: vacancy =>
    `Здравствуйте! Спасибо за интерес к вакансии «${vacancy}». Сейчас мы продолжим общение с другими кандидатами, ` +
    "чей опыт ближе к задачам. Желаем удачи в поиске!",
};

/** Причина отказа в один клик (план 2.5.1): кандидат получает полезный ответ, а не безликий шаблон. */
export const REJECT_REASONS: { label: string; text: string }[] = [
  { label: "Не хватило опыта со стеком", text: "Причина: нам нужен больше практического опыта с основным стеком вакансии." },
  { label: "Вилка выше бюджета", text: "Причина: ваши ожидания по зарплате выше бюджета этой позиции." },
  { label: "Взяли кандидата", text: "Причина: мы уже выбрали кандидата на эту позицию." },
  { label: "Формат или часовой пояс", text: "Причина: не совпали формат работы или часовой пояс." },
];

/** Отклик ждёт ответа работодателя. */
export const isWaiting = (app: Pick<Application, "status">) => app.status === "new" || app.status === "viewed";

/** Форма, заполненная полями существующей вакансии. */
export function formFromVacancy(vacancy: Vacancy): VacancyForm {
  return {
    title: vacancy.title,
    description: vacancy.description ?? "",
    salaryMin: vacancy.salary_min?.toString() ?? "",
    salaryMax: vacancy.salary_max?.toString() ?? "",
    currency: vacancy.salary_currency ?? "RUB",
    city: vacancy.city ?? "",
    isRemote: Boolean(vacancy.is_remote),
    stack: (vacancy.stack ?? []).join(", "),
    questions: [0, 1, 2].map(i => vacancy.blitz_questions?.[i] ?? "") as [string, string, string],
  };
}

/** Форма после черновика ИИ: пустые поля черновика не затирают введённое. */
export function formWithDraft(prev: VacancyForm, draft: VacancyDraft): VacancyForm {
  return {
    ...prev,
    title: draft.title,
    description: draft.description,
    salaryMin: draft.salary_min ? String(draft.salary_min) : prev.salaryMin,
    salaryMax: draft.salary_max ? String(draft.salary_max) : prev.salaryMax,
    city: draft.city ?? prev.city,
    isRemote: draft.is_remote || prev.isRemote,
    stack: draft.stack.join(", ") || prev.stack,
  };
}

export interface VacancyFields {
  title: string;
  description: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  city: string | null;
  is_remote: boolean;
  company_name: string | null;
  stack: string[];
  blitz_questions: string[];
  discrimination_flags: DiscriminationFlag[];
}

/** Поля вакансии для базы из формы; error — форму нельзя сохранить. */
export function vacancyFields(form: VacancyForm, companyName: string | null): { error: string } | { fields: VacancyFields } {
  const salaryMin = form.salaryMin ? parseInt(form.salaryMin, 10) : null;
  const salaryMax = form.salaryMax ? parseInt(form.salaryMax, 10) : null;
  if (salaryMin && salaryMax && salaryMin > salaryMax) {
    return { error: "Зарплата «от» больше, чем «до»." };
  }
  return {
    fields: {
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
      // Требования к возрасту, полу, национальности: база уберёт вакансию из ленты
      discrimination_flags: discriminationFlags(`${form.title}\n${form.description}`),
    },
  };
}

/** Порядок откликов: по совпадению, по вердикту ИИ (при равном — по совпадению) или как пришли. */
export function sortApplications(
  applications: Application[], sortBy: SortBy, matches: Record<string, Match>, screenings: Record<string, Screening>,
): Application[] {
  if (sortBy === "match") return [...applications].sort((a, b) => (matches[b.id]?.score ?? -1) - (matches[a.id]?.score ?? -1));
  if (sortBy === "ai") {
    return [...applications].sort((a, b) =>
      (FIT_ORDER[screenings[a.id]?.fit] ?? 3) - (FIT_ORDER[screenings[b.id]?.fit] ?? 3)
      || (matches[b.id]?.score ?? -1) - (matches[a.id]?.score ?? -1));
  }
  return applications;
}

/** Массовый отказ: письма по вакансиям, у каждого кандидата название своей вакансии и общая причина. */
export function bulkRejections(applications: Application[], selected: Set<string>, reasonLabel: string | null) {
  const reason = REJECT_REASONS.find(r => r.label === reasonLabel);
  const chosen = applications.filter(a => selected.has(a.id) && isWaiting(a));
  const byTitle = new Map<string, string[]>();
  for (const a of chosen) byTitle.set(a.vacancies.title, [...(byTitle.get(a.vacancies.title) ?? []), a.id]);
  return [...byTitle].map(([title, ids]) => ({
    ids,
    message: (REPLY_TEMPLATES.rejected(title) + (reason ? `\n\n${reason.text}` : "")).slice(0, 2000),
  }));
}

export interface FunnelStep { label: string; value: number; color: string; word: [string, string, string] }

/** Воронка вакансии: просмотры → отклики → приглашения; top — длина самой длинной полосы. */
export function vacancyFunnel(views: number, forVacancy: Pick<Application, "status">[]): { steps: FunnelStep[]; top: number } {
  const count = forVacancy.length;
  const invited = forVacancy.filter(a => a.status === "interview_scheduled").length;
  return {
    top: Math.max(views, count, invited, 1),
    steps: [
      { label: "Просмотры", value: views, color: "bg-indigo-400", word: ["просмотр", "просмотра", "просмотров"] },
      { label: "Отклики", value: count, color: "bg-teal-300", word: ["отклик", "отклика", "откликов"] },
      { label: "Приглашения", value: invited, color: "bg-teal-100", word: ["приглашение", "приглашения", "приглашений"] },
    ],
  };
}
