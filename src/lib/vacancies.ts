import { supabase } from "@/lib/supabase";

export interface Vacancy {
  id: string;
  title: string;
  company_name: string | null;
  description: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
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
  level?: Level | null;
  direction?: string | null;
  work_format?: WorkFormat | null;
}

/** Колонки для показа: без служебных (search_tsv, title_key, text_fingerprint, raw_hash) — они только раздувают ответ. */
// Одной строкой-литералом: по ней supabase-js выводит тип строк ответа
export const VACANCY_COLUMNS = "id, title, company_name, description, salary_min, salary_max, salary_currency, city, is_remote, contact_type, contact_value, created_at, posted_at, source_type, source_url, stack, employer_id, archived_at, level, direction, work_format";

export type Level = "intern" | "junior" | "middle" | "senior" | "lead";
export type WorkFormat = "remote" | "hybrid" | "office";

export interface VacancyFilters {
  search: string;
  /** Формат работы; пусто — любой. */
  format: WorkFormat | "";
  minSalary: number;
  withSalary: boolean;
  city: string;
  /** Направление (vacancies.direction); пусто — все. */
  direction: string;
  /** Уровни: вакансия подходит, если её уровень среди выбранных. */
  levels: Level[];
  /** Технологии: вакансия подходит, если упоминает хотя бы одну. */
  stack: string[];
}

export const PAGE_SIZE = 30;

/** Фильтры ленты при открытии страницы. Порядок ключей — как в Feed: по нему сравниваются JSON-строки. */
export const DEFAULT_FILTERS: VacancyFilters = {
  search: "",
  format: "",
  minSalary: 0,
  withSalary: false,
  city: "",
  direction: "",
  levels: [],
  stack: [],
};

export interface Direction {
  id: string;
  label: string;
  group: "it" | "other";
  /** Технологии для уточнения внутри направления. */
  tech?: string[];
}

/** Направления — те же значения, что в ограничении vacancies.direction (supabase/migrations). */
export const DIRECTIONS: Direction[] = [
  { id: "backend", label: "Backend", group: "it", tech: ["Java", "Python", "Go", "Node.js", "PHP", "C#", ".NET", "1С", "SQL", "Spring", "Django"] },
  { id: "frontend", label: "Frontend", group: "it", tech: ["React", "Vue", "Angular", "TypeScript", "JavaScript", "Next.js"] },
  { id: "fullstack", label: "Fullstack", group: "it", tech: ["React", "Node.js", "Python", "TypeScript", "PHP"] },
  { id: "mobile", label: "Мобильная разработка", group: "it", tech: ["iOS", "Android", "Swift", "Kotlin", "Flutter", "React Native"] },
  { id: "qa", label: "QA и тестирование", group: "it", tech: ["Selenium", "Playwright", "Cypress", "Appium", "Postman", "Python", "Java"] },
  { id: "devops", label: "DevOps и инфраструктура", group: "it", tech: ["Docker", "Kubernetes", "Linux", "Terraform", "Ansible", "CI/CD"] },
  { id: "data_ml", label: "Data / ML / AI", group: "it", tech: ["Python", "SQL", "PyTorch", "Spark", "Airflow", "LLM"] },
  { id: "analytics", label: "Аналитика", group: "it", tech: ["SQL", "Python", "Excel", "Power BI", "Tableau"] },
  { id: "security", label: "Безопасность", group: "it" },
  { id: "gamedev", label: "Gamedev", group: "it", tech: ["Unity", "Unreal Engine", "C#", "C++"] },
  { id: "design", label: "Дизайн и арт", group: "other", tech: ["Figma", "Photoshop", "Blender", "After Effects"] },
  { id: "product", label: "Продукт и проекты", group: "other" },
  { id: "marketing", label: "Маркетинг и SMM", group: "other" },
  { id: "content", label: "Медиа и контент", group: "other" },
  { id: "sales", label: "Продажи", group: "other" },
  { id: "hr", label: "HR", group: "other" },
  { id: "support", label: "Поддержка", group: "other" },
  { id: "finance", label: "Финансы", group: "other" },
  { id: "education", label: "Образование", group: "other" },
  { id: "other", label: "Другое", group: "other" },
];

export const LEVELS: { id: Level; label: string }[] = [
  { id: "intern", label: "Стажёр" },
  { id: "junior", label: "Junior" },
  { id: "middle", label: "Middle" },
  { id: "senior", label: "Senior" },
  { id: "lead", label: "Lead" },
];

export const WORK_FORMATS: { id: WorkFormat; label: string }[] = [
  { id: "remote", label: "Удалённо" },
  { id: "hybrid", label: "Гибрид" },
  { id: "office", label: "Офис" },
];

export const levelLabel = (level?: string | null) => LEVELS.find(l => l.id === level)?.label ?? null;
export const formatLabel = (format?: string | null) => WORK_FORMATS.find(f => f.id === format)?.label ?? null;

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

/**
 * Поиск по названию, компании и описанию. Два способа через ИЛИ:
 * - по словоформам (search_tsv, словарь russian): «разработчики» находит «разработчика»,
 *   «python разработчик» — вакансии, где есть оба слова;
 * - по подстроке без учёта регистра: «postgres» находит «PostgreSQL».
 * Для запросов с «+», «#» или «.» (C++, C#, .NET) — только подстрока: словарь
 * отбрасывает эти знаки, и «C++» находил бы любое «C».
 */
export function searchCondition(search: string): string | null {
  const s = search.trim().slice(0, 200);
  if (!s) return null;
  const like = quoted(`%${s.replace(/[%_\\]/g, "\\$&")}%`);
  const parts = [`title.ilike.${like}`, `description.ilike.${like}`, `company_name.ilike.${like}`];
  if (!/[+#.]/.test(s)) parts.unshift(`search_tsv.wfts(russian).${quoted(s)}`);
  return parts.join(",");
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
    .select(VACANCY_COLUMNS, { count: "exact" })
    .is("archived_at", null);

  if (filters.format) query = query.eq("work_format", filters.format);
  if (filters.direction) query = query.eq("direction", filters.direction);
  if (filters.levels.length) query = query.in("level", filters.levels);
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
  // Ползунок в рублях: зарплаты в других валютах с ним не сравниваем
  if (filters.minSalary > 0) query = query.or("salary_currency.is.null,salary_currency.eq.RUB");

  const from = page * PAGE_SIZE;
  const { data, count, error } = await query
    // Прямые работодатели (ranking_weight 1.5) выше вакансий из Telegram
    .order("ranking_weight", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) throw error;
  return { rows: (data ?? []) as Vacancy[], total: count ?? 0 };
}

const CURRENCY_SIGNS: Record<string, string> = {
  RUB: "₽", USD: "$", EUR: "€", KZT: "₸", BYN: "Br", UAH: "₴", UZS: "сум", GEL: "₾",
  AMD: "֏", TRY: "₺", AED: "AED", RSD: "RSD", PLN: "zł",
};

/**
 * Вилка зарплаты. Валюта берётся из вакансии; у старых вакансий из Telegram
 * она неизвестна — тогда показываем число без знака, а не подставляем ₽.
 */
export function formatSalary(min: number | null, max: number | null, currency?: string | null): string {
  if (!min && !max) return "По договорённости";
  const sign = currency ? ` ${CURRENCY_SIGNS[currency] ?? currency}` : "";
  const n = (v: number) => v.toLocaleString("ru-RU");
  if (min && max) return min === max ? `${n(min)}${sign}` : `${n(min)} — ${n(max)}${sign}`;
  if (min) return `от ${n(min)}${sign}`;
  return `до ${n(max!)}${sign}`;
}

/** «1 вакансия», «3 вакансии», «5 вакансий». */
export function plural(count: number, forms: [string, string, string]): string {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export const VACANCY_FORMS: [string, string, string] = ["вакансия", "вакансии", "вакансий"];
