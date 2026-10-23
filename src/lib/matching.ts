import { supabase } from "@/lib/supabase";
import { VACANCY_COLUMNS, type Vacancy } from "@/lib/vacancies";

/** Насколько вакансия подходит кандидату (считает база: функция vacancy_match). */
export interface Match {
  score: number;
  /** Навыки кандидата, которые есть в вакансии. */
  matched: string[];
  /** Навыки из вакансии, которых нет в профиле. */
  missing: string[];
}

type MatchRow = { id: string; score: number; matched: unknown; missing: unknown };

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];

const toMatch = (row: MatchRow): Match => ({ score: row.score, matched: strings(row.matched), missing: strings(row.missing) });

/** Совпадение для вакансий на экране. Не кандидату или без входа — пусто. */
export async function fetchMatches(ids: string[]): Promise<Record<string, Match>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.rpc("my_vacancy_matches", { ids: ids.slice(0, 100) });
  if (error) throw error;
  return Object.fromEntries((data ?? []).map(row => [row.id, toMatch(row)]));
}

/** Страница подборки «Для вас»: вакансии по убыванию совпадения. */
export async function fetchRecommended(page: number, pageSize = 30): Promise<{ rows: Vacancy[]; matches: Record<string, Match>; hasMore: boolean }> {
  const { data, error } = await supabase.rpc("recommended_vacancies", { page_size: pageSize, page });
  if (error) throw error;
  const ranked = data ?? [];
  if (!ranked.length) return { rows: [], matches: {}, hasMore: false };

  const { data: vacancies, error: vacanciesError } = await supabase
    .from("vacancies")
    .select(VACANCY_COLUMNS)
    .in("id", ranked.map(r => r.id));
  if (vacanciesError) throw vacanciesError;

  const byId = new Map((vacancies ?? []).map(v => [v.id, v as Vacancy]));
  return {
    rows: ranked.map(r => byId.get(r.id)).filter((v): v is Vacancy => Boolean(v)),
    matches: Object.fromEntries(ranked.map(r => [r.id, toMatch(r)])),
    hasMore: ranked.length === pageSize,
  };
}

/** Цвет значка совпадения. */
export function matchTone(score: number): string {
  if (score >= 75) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  if (score >= 50) return "bg-amber-500/10 text-amber-300 border-amber-500/30";
  return "bg-neutral-800/60 text-neutral-400 border-neutral-700";
}
