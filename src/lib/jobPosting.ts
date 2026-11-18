import { isAbroad } from "@/lib/salary";
import type { Vacancy } from "@/lib/vacancies";

/** Страны из vacancies.country (по-русски, как пишет сборщик) → ISO 3166-1 alpha-2 для schema.org. */
const COUNTRY_CODES: Record<string, string> = {
  "россия": "RU", "беларусь": "BY", "белоруссия": "BY", "казахстан": "KZ", "узбекистан": "UZ",
  "кыргызстан": "KG", "киргизия": "KG", "таджикистан": "TJ", "армения": "AM", "грузия": "GE",
  "азербайджан": "AZ", "молдова": "MD", "сербия": "RS", "черногория": "ME", "турция": "TR",
  "оаэ": "AE", "кипр": "CY", "израиль": "IL", "германия": "DE", "польша": "PL", "нидерланды": "NL",
  "франция": "FR", "испания": "ES", "португалия": "PT", "италия": "IT", "чехия": "CZ", "австрия": "AT",
  "латвия": "LV", "литва": "LT", "эстония": "EE", "финляндия": "FI", "великобритания": "GB",
  "сша": "US", "канада": "CA", "таиланд": "TH", "индонезия": "ID", "вьетнам": "VN", "сингапур": "SG",
  "китай": "CN", "монголия": "MN", "катар": "QA",
};

/**
 * Страна вакансии для разметки: ISO-код, если страна известна; название как есть, если её нет
 * в словаре. Страна не указана — Россия (вакансии из русскоязычных источников), кроме городов
 * за рубежом: там страну не угадываем.
 */
export function countryOf(v: Pick<Vacancy, "country" | "city">): string | null {
  const name = v.country?.trim();
  if (name) return COUNTRY_CODES[name.toLowerCase()] ?? name;
  return isAbroad(v.city) ? null : "RU";
}

type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACTOR" | "INTERN";

const EMPLOYMENT_PATTERNS: [EmploymentType, RegExp][] = [
  ["FULL_TIME", /полн[а-яё]* занятост|full[- ]?time|фул+[- ]?тайм/i],
  ["PART_TIME", /частичн[а-яё]* занятост|неполн[а-яё]* (?:рабоч[а-яё]* )?(?:день|занятост)|part[- ]?time|парт[- ]?тайм/i],
  ["CONTRACTOR", /проектн[а-яё]* (?:работ|занятост)|фриланс|freelance|гпх|договор[а-яё]* подряда/i],
  ["INTERN", /стажир|стажёр|internship/i],
];

/** Тип занятости по уровню и тексту вакансии; ничего не нашли — полная занятость (так у большинства вакансий). */
export function employmentTypeOf(v: Pick<Vacancy, "title" | "description" | "level">): EmploymentType | EmploymentType[] {
  const text = `${v.title}\n${v.description ?? ""}`;
  const found = new Set(EMPLOYMENT_PATTERNS.filter(([, re]) => re.test(text)).map(([type]) => type));
  if (v.level === "intern") found.add("INTERN");
  const types = [...found];
  if (!types.length) return "FULL_TIME";
  return types.length === 1 ? types[0] : types;
}

export const isRemote = (v: Pick<Vacancy, "work_format" | "is_remote">) =>
  v.work_format === "remote" || (!v.work_format && Boolean(v.is_remote));

/**
 * Разметка schema.org/JobPosting: по ней Google показывает вакансии в поиске.
 * Обязательные поля Google: title, description, datePosted, hiringOrganization и место работы —
 * jobLocation (адрес хотя бы со страной) или, для удалёнки, jobLocationType TELECOMMUTE со страной
 * кандидата (applicantLocationRequirements). Без компании или без места разметка не выводится:
 * неполная только копит ошибки в Search Console и всё равно не попадает в выдачу вакансий.
 */
export function jobPostingJsonLd(v: Vacancy) {
  if (!v.company_name?.trim()) return null;
  const remote = isRemote(v);
  const country = countryOf(v);
  const city = v.city?.trim() || null;
  const address = {
    "@type": "PostalAddress",
    ...(city ? { addressLocality: city } : {}),
    ...(country ? { addressCountry: country } : {}),
  };
  // Офис или гибрид: нужен адрес. Удалёнка: адрес — только если город указан
  const jobLocation = city || (!remote && country) ? { "@type": "Place", address } : null;
  const applicantCountry = remote && country ? { "@type": "Country", name: country } : null;
  if (!jobLocation && !applicantCountry) return null;

  const posted = v.posted_at ?? v.created_at;
  const validThrough = new Date(Date.parse(posted) + 30 * 864e5).toISOString();
  const salaryValue = v.salary_min || v.salary_max
    ? {
        "@type": "MonetaryAmount",
        currency: v.salary_currency ?? undefined,
        value: { "@type": "QuantitativeValue", minValue: v.salary_min ?? undefined, maxValue: v.salary_max ?? undefined, unitText: "MONTH" },
      }
    : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: v.title,
    description: v.description ?? v.title,
    datePosted: posted,
    validThrough,
    employmentType: employmentTypeOf(v),
    ...(remote ? { jobLocationType: "TELECOMMUTE" } : {}),
    ...(applicantCountry ? { applicantLocationRequirements: applicantCountry } : {}),
    ...(jobLocation ? { jobLocation } : {}),
    ...(salaryValue && v.salary_currency ? { baseSalary: salaryValue } : {}),
    ...(v.stack?.length ? { skills: v.stack.join(", ") } : {}),
    hiringOrganization: { "@type": "Organization", name: v.company_name.trim() },
  };
}
