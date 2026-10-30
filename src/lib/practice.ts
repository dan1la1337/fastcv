// Тренажёр собеседования: вопросы по вакансии и разбор ответов. Разбор ответа модели и
// запасные вопросы без ИИ — здесь, чтобы страница и сервер понимали один формат.

export type PracticeKind = "tech" | "behavior" | "employer";
export type PracticeQuestion = { q: string; kind: PracticeKind; hint?: string };
export type PracticeGrade = { score: number; verdict: string; good: string[]; improve: string[]; better: string };

export const QUESTION_COUNT = 6;
export const ANSWER_MAX = 3000;

export const KIND_LABEL: Record<PracticeKind, string> = {
  tech: "Технический",
  behavior: "Про опыт",
  employer: "Вопрос работодателя",
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown, n: number, max: number) =>
  Array.isArray(v) ? v.map(x => str(x, max)).filter(Boolean).slice(0, n) : [];

/** Достаём JSON из ответа модели (бывает обёрнут в ```json … ```). */
export function parseModelJson(text: string): unknown {
  const body = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
  }
}

/** Вопросы от модели → проверенный список; вопросы работодателя — первыми и дословно. */
export function toQuestions(raw: unknown, employer: string[]): PracticeQuestion[] {
  const items = Array.isArray(raw) ? raw : Array.isArray((raw as { questions?: unknown })?.questions) ? (raw as { questions: unknown[] }).questions : [];
  const own: PracticeQuestion[] = employer.slice(0, 3).map(q => ({ q: str(q, 300), kind: "employer" as const })).filter(x => x.q);
  const seen = new Set(own.map(x => x.q.toLowerCase()));
  const generated: PracticeQuestion[] = [];
  for (const item of items) {
    const q = str((item as { q?: unknown })?.q ?? item, 300);
    if (!q || q.length < 10 || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    const kind = (item as { kind?: unknown })?.kind === "behavior" ? "behavior" : "tech";
    const hint = str((item as { hint?: unknown })?.hint, 200) || undefined;
    generated.push({ q, kind, hint });
  }
  return [...own, ...generated].slice(0, QUESTION_COUNT);
}

/** Запасные вопросы без ИИ: по стеку вакансии и общие про опыт. */
export function fallbackQuestions(title: string, stack: string[], employer: string[]): PracticeQuestion[] {
  const tech = stack.slice(0, 3).map(s => ({
    q: `Расскажите о самом сложном, что вы делали с ${s}. Какие были проблемы и как вы их решили?`,
    kind: "tech" as const,
    hint: "Конкретный проект, ваша роль, решение и результат в цифрах.",
  }));
  const behavior: PracticeQuestion[] = [
    { q: `Почему вас интересует позиция «${title}» и чем вы будете полезны команде?`, kind: "behavior", hint: "Свяжите свой опыт с задачами из вакансии." },
    { q: "Расскажите о случае, когда вы ошиблись в работе. Что сделали потом?", kind: "behavior", hint: "Ситуация → действия → результат → вывод." },
    { q: "Как вы разбираетесь в незнакомой части кода или новой технологии?", kind: "tech", hint: "Ваш порядок действий и пример." },
  ];
  return toQuestions([...tech, ...behavior], employer);
}

/** Оценка ответа от модели → проверенный разбор или null. */
export function toGrade(raw: unknown): PracticeGrade | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const score = Math.round(Number(r.score));
  if (!Number.isFinite(score) || score < 1 || score > 10) return null;
  const verdict = str(r.verdict, 300);
  if (!verdict) return null;
  return { score, verdict, good: list(r.good, 4, 300), improve: list(r.improve, 4, 300), better: str(r.better, 1200) };
}

/** Итог тренировки: средний балл и самые слабые вопросы. */
export function summary(grades: (PracticeGrade | null | undefined)[]): { average: number; answered: number } | null {
  const done = grades.filter((g): g is PracticeGrade => !!g);
  if (!done.length) return null;
  return { average: Math.round((done.reduce((s, g) => s + g.score, 0) / done.length) * 10) / 10, answered: done.length };
}
