/** Черновик профиля, который ИИ собрал из PDF-резюме (POST /api/resume-autofill). */
export interface ResumeDraft {
  name: string | null;
  about: string | null;
  skills: string[];
  /** Основной стек: язык и платформа, на которых кандидат реально работает (1–5) */
  primary_skills: string[];
  level: string | null;
  /** Почему такой уровень и что добавить в резюме для следующего */
  level_reason: string | null;
  directions: string[];
  /** Опыт по профессии, лет — посчитан по датам мест работы, а не на глаз */
  experience_years: number | null;
  leads_people: boolean;
  formats: string[];
  city: string | null;
  salary: number | null;
}

export type ResumeJob = { start?: unknown; end?: unknown; relevant?: unknown };

// «2019–2020» в резюме обычно значит «с начала 2019 по конец 2020»: год без месяца
// в начале периода — январь, в конце — декабрь
const month = (v: unknown, end = false): number | null => {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const y = Number(m[1]), mo = m[2] ? Number(m[2]) : end ? 12 : 1;
  if (y < 1960 || y > 2100 || mo < 1 || mo > 12) return null;
  return y * 12 + (mo - 1);
};

/**
 * Опыт по датам мест работы: объединяем пересекающиеся периоды (две работы
 * одновременно не удваивают опыт), «по настоящее время» — до текущего месяца.
 * Учитываем только места, которые модель отметила как относящиеся к профессии.
 */
export function experienceFromJobs(jobs: ResumeJob[], now: Date = new Date()): number | null {
  const current = now.getFullYear() * 12 + now.getMonth();
  const spans = jobs
    .filter(j => j.relevant !== false)
    .map(j => {
      const start = month(j.start);
      const end = j.end == null || j.end === "" || j.end === "present" ? current : month(j.end, true);
      return start != null && end != null && end >= start ? [start, Math.min(end, current)] as [number, number] : null;
    })
    .filter((x): x is [number, number] => !!x)
    .sort((a, b) => a[0] - b[0]);
  if (!spans.length) return null;
  let total = 0;
  let [s, e] = spans[0];
  for (const [a, b] of spans.slice(1)) {
    if (a <= e + 1) e = Math.max(e, b);
    else { total += e - s + 1; [s, e] = [a, b]; }
  }
  total += e - s + 1;
  return Math.min(50, Math.round((total / 12) * 2) / 2);
}
