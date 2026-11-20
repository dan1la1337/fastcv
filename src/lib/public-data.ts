// Только для серверного кода: публичные данные главной, каталога и страниц направлений и компаний.
// С CSP по nonce эти страницы рендерятся на каждый запрос (layout читает заголовки), поэтому
// ответы базы держим в кэше данных Next.js с прежним сроком revalidate этих страниц.
// Клиент — анонимный (@/lib/supabase на сервере, без сессии): в кэш попадает только то,
// что видит любой гость. Данные вошедшего пользователя сюда не добавлять.

import { unstable_cache } from "next/cache";
import { CATALOG_PAGE_SIZE } from "@/lib/catalog-pages";
import { fetchLiveStats } from "@/lib/live";
import type { CompanyRating } from "@/lib/rating";
import { supabase } from "@/lib/supabase";
import { DEFAULT_FILTERS, VACANCY_COLUMNS, fetchVacancyPage, type Vacancy } from "@/lib/vacancies";

/** Главная: первая страница ленты и счётчик — 5 минут. */
export const HOME_REVALIDATE = 300;
/** Каталог, направления, компании: вакансии приходят раз в 6 часов — полчаса. */
export const CATALOG_REVALIDATE = 1800;


export const cachedHomeFeed = unstable_cache(
  () => fetchVacancyPage(DEFAULT_FILTERS, 0), ["public:home-feed"], { revalidate: HOME_REVALIDATE });

export const cachedLiveStats = unstable_cache(
  () => fetchLiveStats(), ["public:live-stats"], { revalidate: HOME_REVALIDATE });

/** Открытых вакансий по направлениям. Агрегат в базе: вакансий десятки тысяч, читать строки нельзя. */
export const cachedDirectionCounts = unstable_cache(async (): Promise<Record<string, number>> => {
  const { data } = await supabase.from("direction_counts").select("direction, vacancies");
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.direction] = row.vacancies;
  return counts;
}, ["public:direction-counts"], { revalidate: CATALOG_REVALIDATE });

/** Страница каталога: вакансии одной страницы и есть ли следующая. */
export type CatalogPage = { vacancies: Vacancy[]; hasNext: boolean; total: number | null };

/** Строка выборки с from по to (включительно): CATALOG_PAGE_SIZE + 1 — чтобы узнать, есть ли следующая страница. */
function pageSlice(page: number): [number, number] {
  const from = (page - 1) * CATALOG_PAGE_SIZE;
  return [from, from + CATALOG_PAGE_SIZE];
}

function toPage(data: unknown[] | null, total: number | null): CatalogPage {
  const rows = (data ?? []) as Vacancy[];
  return { vacancies: rows.slice(0, CATALOG_PAGE_SIZE), hasNext: rows.length > CATALOG_PAGE_SIZE, total };
}

/** Страница направления. Число вакансий — из direction_counts: точный count по направлению
 *  с десятками тысяч строк упирается в statement_timeout анонимной роли. Порядок с id в конце:
 *  без него страницы на равных created_at пересекаются. */
export const cachedDirectionVacancies = unstable_cache(async (direction: string, page = 1): Promise<CatalogPage> => {
  const { data } = await supabase
    .from("vacancies")
    .select(VACANCY_COLUMNS)
    .is("archived_at", null)
    .eq("direction", direction)
    .order("ranking_weight", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range(...pageSlice(page));
  return toPage(data, null);
}, ["public:direction-page"], { revalidate: CATALOG_REVALIDATE });

/** Название компании сравнивается без учёта регистра; % и _ — не шаблоны. */
/** Страница компании. У компании вакансий немного — точный count укладывается в лимит времени. */
export const cachedCompanyVacancies = unstable_cache(async (name: string, page = 1): Promise<CatalogPage> => {
  if (!name) return { vacancies: [], hasNext: false, total: 0 };
  const { data, count } = await supabase
    .from("vacancies")
    .select(VACANCY_COLUMNS, { count: "exact" })
    .is("archived_at", null)
    .ilike("company_name", name.replace(/[%_\\]/g, "\\$&"))
    .order("created_at", { ascending: false })
    .order("id")
    .range(...pageSlice(page));
  return toPage(data, count ?? null);
}, ["public:company-page"], { revalidate: CATALOG_REVALIDATE });

export const cachedCompanyRating = unstable_cache(async (name: string): Promise<CompanyRating | null> => {
  if (!name) return null;
  const { data } = await supabase.rpc("company_rating", { company: name });
  return (data as CompanyRating | null) ?? null;
}, ["public:company-rating"], { revalidate: CATALOG_REVALIDATE });
