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
  /** Когда вакансию впервые заметили (самая ранняя публикация) и во скольких каналах она выходила. */
  first_seen_at?: string | null;
  channels_count?: number;
  /** Требуемый опыт в годах из текста вакансии (ИИ сборщика); null — не указан. */
  experience_min?: number | null;
  /** Если в вакансии смешаны обязанности нескольких ролей — что именно (ИИ сборщика). */
  scope_note?: string | null;
  /** Кто нанимает (определяет ИИ сборщика): своя команда, аутстафф или агентство. */
  hiring_type?: HiringType | null;
  /** Просмотры страницы вакансии (видит работодатель в своём кабинете). */
  views_count?: number;
}

/** Колонки для показа: без служебных (search_tsv, title_key, text_fingerprint, raw_hash) — они только раздувают ответ. */
// Одной строкой-литералом: по ней supabase-js выводит тип строк ответа
export const VACANCY_COLUMNS = "id, title, company_name, description, salary_min, salary_max, salary_currency, city, is_remote, contact_type, contact_value, created_at, posted_at, source_type, source_url, stack, employer_id, archived_at, level, direction, work_format, hiring_type, first_seen_at, channels_count, scope_note, experience_min";

export type Level = "intern" | "junior" | "middle" | "senior" | "lead";
export type WorkFormat = "remote" | "hybrid" | "office";
export type HiringType = "product" | "outsource" | "agency";

/** Откуда вакансия: для подписи на карточке и ссылки на оригинал. */
export function sourceOf(v: Pick<Vacancy, "source_type" | "source_url">): { badge: string; link: string } {
  if (v.source_type === "internal") return { badge: "Прямой работодатель", link: "" };
  if (v.source_url?.includes("trudvsem.ru")) return { badge: "Работа России", link: "Вакансия на trudvsem.ru" };
  if (v.source_url?.includes("superjob.ru")) return { badge: "SuperJob", link: "Вакансия на SuperJob" };
  // Вакансии с карьерных сайтов работодателей: ссылка ведёт на страницу вакансии компании
  if (v.source_url && !/^https?:\/\/t\.me\//.test(v.source_url)) return { badge: "Сайт компании", link: "Откликнуться на сайте компании" };
  return { badge: "Telegram", link: "Пост в Telegram" };
}

/** Грейд по опыту (шкала FastCV): до 2 лет — junior, 2–5 — middle, от 5 — senior; руководство людьми — lead. */
export function levelForExperience(years: number, leadsPeople = false): Level {
  if (leadsPeople) return "lead";
  if (years < 2) return "junior";
  if (years < 5) return "middle";
  return "senior";
}

/**
 * Поля профиля из «опыта работы»: годы и грейд по шкале. Опыт не указан — уровень
 * остаётся прежним (например, заполненным из резюме).
 */
export function experienceFields(years: string, leadsPeople: boolean, fallback: Level | ""): { experience_years: number | null; pref_level: Level | null } {
  const value = Number(years.replace(",", "."));
  if (years.trim() === "" || !Number.isFinite(value) || value < 0 || value > 60) {
    return { experience_years: null, pref_level: leadsPeople ? "lead" : fallback || null };
  }
  const rounded = Math.round(value * 2) / 2;
  return { experience_years: rounded, pref_level: levelForExperience(rounded, leadsPeople) };
}

/** «опыт от 3 лет», «опыт от 1,5 года», «без опыта» */
export function experienceLabel(years: number | null | undefined): string | null {
  if (years === null || years === undefined) return null;
  if (years <= 0) return "без опыта";
  const n = Number.isInteger(years) ? String(years) : years.toLocaleString("ru-RU");
  const word = !Number.isInteger(years) ? "года" : plural(years, ["года", "лет", "лет"]);
  return `опыт от ${n} ${word}`;
}

const HIRING_LABELS: Record<HiringType, { alone: string; withCompany: string | null }> = {
  product: { alone: "Продуктовая компания", withCompany: null },
  outsource: { alone: "Аутстафф или интегратор", withCompany: "аутстафф" },
  agency: { alone: "Кадровое агентство", withCompany: "через агентство" },
};

/**
 * Подпись «кто нанимает» под названием вакансии. Без компании — вместо неё
 * («Кадровое агентство»), с компанией — короткое уточнение, если это не прямой наём.
 */
export function hiringLabel(v: Pick<Vacancy, "company_name" | "hiring_type" | "source_type">): string | null {
  if (v.source_type === "internal" || !v.hiring_type) return null;
  const labels = HIRING_LABELS[v.hiring_type];
  return v.company_name ? labels.withCompany : labels.alone;
}

export interface VacancyFilters {
  search: string;
  /** Форматы работы (можно несколько); пусто — любой. */
  formats: WorkFormat[];
  minSalary: number;
  withSalary: boolean;
  city: string;
  /** Направление (vacancies.direction); пусто — все. */
  direction: string;
  /** Раздел ленты: разработка или продукт/дизайн/digital; пусто — все. */
  area: Area | "";
  /** Уровни: вакансия подходит, если её уровень среди выбранных. */
  levels: Level[];
  /** Технологии: вакансия подходит, если упоминает хотя бы одну. */
  stack: string[];
}

export const PAGE_SIZE = 30;

/** Фильтры ленты при открытии страницы. Порядок ключей — как в Feed: по нему сравниваются JSON-строки. */
export const DEFAULT_FILTERS: VacancyFilters = {
  search: "",
  formats: [],
  minSalary: 0,
  withSalary: false,
  city: "",
  direction: "",
  area: "",
  levels: [],
  stack: [],
};

export type Area = "it" | "other" | "work";

/** Разделы ленты (план 2.5.1): у FastCV и разработка, и digital — показываем их честно раздельно. */
export const AREAS: { id: Area; label: string; short: string }[] = [
  { id: "it", label: "Разработка и данные", short: "Разработка" },
  { id: "other", label: "Продукт, дизайн и digital", short: "Digital" },
  { id: "work", label: "Другие профессии", short: "Профессии" },
];

export interface Direction {
  id: string;
  label: string;
  group: Area;
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
  { id: "management", label: "Руководители", group: "work" },
  { id: "office", label: "Офис и администрирование", group: "work" },
  { id: "legal", label: "Юристы", group: "work" },
  { id: "medicine", label: "Медицина и фармацевтика", group: "work" },
  { id: "logistics", label: "Логистика, склад, водители", group: "work" },
  { id: "construction", label: "Строительство и недвижимость", group: "work" },
  { id: "production", label: "Производство и рабочие профессии", group: "work" },
  { id: "hospitality", label: "Рестораны, гостиницы, туризм", group: "work" },
  { id: "government", label: "Госслужба и охрана", group: "work" },
  { id: "other", label: "Другое", group: "work" },
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchVacancyPage(
  filters: VacancyFilters,
  page: number,
  /** Вакансии, которые пользователь скрыл из ленты. */
  excludeIds: string[] = [],
): Promise<{ rows: Vacancy[]; total: number }> {
  let query = supabase
    .from("vacancies")
    .select(VACANCY_COLUMNS, { count: "exact" })
    .is("archived_at", null);

  const exclude = excludeIds.filter(id => UUID.test(id)).slice(0, 300);
  if (exclude.length) query = query.not("id", "in", `(${exclude.join(",")})`);

  if (filters.formats.length) query = query.in("work_format", filters.formats);
  if (filters.direction) query = query.eq("direction", filters.direction);
  else if (filters.area) query = query.in("direction", DIRECTIONS.filter(d => d.group === filters.area).map(d => d.id));
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

const DAY_MS = 864e5;

/**
 * Индекс свежести (план 2.5.1): «сегодня · в 3 каналах». Возраст — от самой ранней
 * публикации, каналы — только для вакансий из Telegram.
 */
export function freshnessLabel(
  v: Pick<Vacancy, "first_seen_at" | "posted_at" | "created_at" | "channels_count" | "source_type">,
  now: number = Date.now(),
): string {
  const since = Date.parse(v.first_seen_at ?? v.posted_at ?? v.created_at);
  const days = Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / DAY_MS)) : 0;
  const age = days === 0 ? "сегодня" : days === 1 ? "вчера" : `${days} ${plural(days, ["день", "дня", "дней"])} назад`;
  const channels = v.source_type === "external" && (v.channels_count ?? 1) > 1
    ? ` · в ${v.channels_count} ${plural(v.channels_count!, ["канале", "каналах", "каналах"])}`
    : "";
  return age + channels;
}

/** Ссылка на страницу компании по её названию. */
export function companyHref(name: string): string {
  return `/company/${encodeURIComponent(name.trim())}`;
}
