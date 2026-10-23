import { supabase } from "@/lib/supabase";
import type { Vacancy } from "@/lib/vacancies";

/** Строка справочника salary_benchmarks: типичная вилка по нашим же вакансиям. */
export interface SalaryBenchmark {
  direction: string;
  level: string | null;
  all_levels: boolean;
  sample: number;
  p25: number;
  p75: number;
}

export interface SalaryEstimate {
  low: number;
  high: number;
  sample: number;
}

export async function fetchSalaryBenchmarks(): Promise<SalaryBenchmark[]> {
  const { data, error } = await supabase
    .from("salary_benchmarks")
    .select("direction, level, all_levels, sample, p25, p75");
  if (error) return [];
  return (data ?? []) as SalaryBenchmark[];
}

/**
 * Оценка для вакансии без зарплаты (план 2.5.1). Уровень известен — только тот же уровень
 * (иначе сеньору покажем вилку джунов); неизвестен — по всем уровням направления.
 * Нет подходящей строки (мало данных или большой разброс) — оценки нет.
 */
export function estimateSalary(
  v: Pick<Vacancy, "salary_min" | "salary_max" | "direction" | "level">,
  benchmarks: SalaryBenchmark[],
): SalaryEstimate | null {
  if (v.salary_min || v.salary_max || !v.direction) return null;
  const row = v.level
    ? benchmarks.find(b => !b.all_levels && b.direction === v.direction && b.level === v.level)
    : benchmarks.find(b => b.all_levels && b.direction === v.direction);
  return row ? { low: row.p25, high: row.p75, sample: row.sample } : null;
}

const thousands = (n: number) => Math.round(n / 5000) * 5;

/** «≈ 70–120 тыс. ₽» */
export function formatEstimate(e: SalaryEstimate): string {
  const low = thousands(e.low), high = thousands(e.high);
  return low === high ? `≈ ${low} тыс. ₽` : `≈ ${low}–${high} тыс. ₽`;
}
