import { supabase } from "@/lib/supabase";

export interface Vacancy {
  id: string;
  title: string;
  description: string | null;
  salary_min: number | null;
  salary_max: number | null;
  city: string | null;
  is_remote: boolean | null;
  contact_type: string | null;
  contact_value: string | null;
  created_at: string;
  posted_at: string | null;
  source_type: string;
  source_url: string | null;
  stack: string[] | null;
  employer_id: string | null;
  archived_at?: string | null;
}

export interface VacancyFilters {
  search: string;
  remote: boolean;
  minSalary: number;
  withSalary: boolean;
  city: string;
  /** Технологии: вакансия подходит, если упоминает хотя бы одну. */
  stack: string[];
}

export const PAGE_SIZE = 30;

export const SPECIALTIES: Record<string, string[]> = {
  Backend: ["Backend", "Java", "Python", "Go", "Golang", "Node.js", "PHP", "C#", ".NET", "SQL", "Spring", "Django"],
  Frontend: ["Frontend", "React", "Vue", "Angular", "TypeScript", "JavaScript", "Next.js", "Tailwind"],
  Mobile: ["iOS", "Android", "Swift", "Kotlin", "Flutter", "React Native"],
  QA: ["QA", "тестировщик", "тестирование", "Selenium", "Cypress", "Appium", "Postman", "Playwright"],
  DevOps: ["DevOps", "SRE", "Docker", "Kubernetes", "CI/CD", "Linux", "Ansible", "Terraform"],
  "Data / ML": ["Data", "ML", "Machine Learning", "Data Science", "Spark", "Airflow", "Pandas", "PyTorch"],
  Design: ["дизайнер", "Designer", "UI", "UX", "Figma"],
};

// --- построение фильтров PostgREST ------------------------------------------

/** Значение в двойных кавычках для фильтра PostgREST: экранируем \ и ". */
function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Регулярка для поиска технологии как отдельного слова: «Go» не должен
 * находить «good», а «Java» — «JavaScript». Границы слова (\m, \M в Postgres)
 * ставим только там, где термин начинается/заканчивается латинской буквой или
 * цифрой: у «C++» или «.NET» с краю спецсимвол, и граница там не сработает.
 */
export function termPattern(term: string): string {
  const t = term.trim();
  const start = /^[A-Za-z0-9_]/.test(t) ? "\\m" : "";
  const end = /[A-Za-z0-9_]$/.test(t) ? "\\M" : "";
  return start + escapeRegex(t) + end;
}

/** Условие «упоминает хотя бы одну технологию»: в извлечённом стеке или в тексте. */
export function stackCondition(terms: string[]): string | null {
  const parts: string[] = [];
  for (const term of terms.map(t => t.trim()).filter(Boolean)) {
    const pattern = quoted(termPattern(term));
    parts.push(`stack.cs.${JSON.stringify([term])}`, `title.imatch.${pattern}`, `description.imatch.${pattern}`);
  }
  return parts.length ? parts.join(",") : null;
}

/** Условие полнотекстового поиска по названию и описанию (подстрока, без учёта регистра). */
export function searchCondition(search: string): string | null {
  const s = search.trim();
  if (!s) return null;
  const like = quoted(`%${s.replace(/[%_\\]/g, "\\$&")}%`);
  return `title.ilike.${like},description.ilike.${like}`;
}

/** Условие по зарплате: верхняя граница вилки не ниже minSalary. */
export function salaryCondition(minSalary: number, withSalary: boolean): string | null {
  if (minSalary > 0) {
    const n = Math.floor(minSalary);
    return `salary_max.gte.${n},and(salary_max.is.null,salary_min.gte.${n})`;
  }
  return withSalary ? "salary_min.not.is.null,salary_max.not.is.null" : null;
}

// --- запросы ----------------------------------------------------------------

export async function fetchVacancyPage(
  filters: VacancyFilters,
  page: number,
): Promise<{ rows: Vacancy[]; total: number }> {
  let query = supabase
    .from("vacancies")
    .select("*", { count: "exact" })
    .is("archived_at", null);

  if (filters.remote) query = query.eq("is_remote", true);
  const city = filters.city.trim();
  if (city) query = query.ilike("city", `%${city.replace(/[%_\\]/g, "\\$&")}%`);

  // Несколько .or() объединяются через И: (поиск) И (стек) И (зарплата)
  for (const condition of [
    searchCondition(filters.search),
    stackCondition(filters.stack),
    salaryCondition(filters.minSalary, filters.withSalary),
  ]) {
    if (condition) query = query.or(condition);
  }

  const from = page * PAGE_SIZE;
  const { data, count, error } = await query
    // Прямые работодатели (ranking_weight 1.5) выше вакансий из Telegram
    .order("ranking_weight", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) throw error;
  return { rows: (data ?? []) as Vacancy[], total: count ?? 0 };
}

export function formatSalary(min: number | null, max: number | null): string {
  if (!min && !max) return "По договорённости";
  if (min && max) return `${min.toLocaleString("ru-RU")} — ${max.toLocaleString("ru-RU")} ₽`;
  if (min) return `от ${min.toLocaleString("ru-RU")} ₽`;
  return `до ${max!.toLocaleString("ru-RU")} ₽`;
}
