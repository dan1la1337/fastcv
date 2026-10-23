import { supabase } from "@/lib/supabase";
import { VACANCY_COLUMNS, type Vacancy } from "@/lib/vacancies";

/** Отметка пользователя на вакансии: в избранном или скрыта из ленты. */
export type MarkKind = "saved" | "hidden";

export async function fetchMarks(): Promise<Map<string, MarkKind>> {
  const { data, error } = await supabase.from("vacancy_marks").select("vacancy_id, kind").limit(1000);
  if (error) throw error;
  return new Map((data ?? []).map(m => [m.vacancy_id, m.kind as MarkKind]));
}

/** Поставить или снять отметку (kind = null). Одна отметка на вакансию. */
export async function setMark(userId: string, vacancyId: string, kind: MarkKind | null): Promise<void> {
  const query = kind
    ? supabase.from("vacancy_marks").upsert({ user_id: userId, vacancy_id: vacancyId, kind, created_at: new Date().toISOString() })
    : supabase.from("vacancy_marks").delete().eq("user_id", userId).eq("vacancy_id", vacancyId);
  const { error } = await query;
  if (error) throw error;
}

/** Вакансии с отметкой, свежие отметки выше. */
export async function fetchMarked(kind: MarkKind): Promise<Vacancy[]> {
  const { data: marks, error } = await supabase
    .from("vacancy_marks")
    .select("vacancy_id")
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const ids = (marks ?? []).map(m => m.vacancy_id);
  if (!ids.length) return [];
  const { data: rows, error: rowsError } = await supabase.from("vacancies").select(VACANCY_COLUMNS).in("id", ids);
  if (rowsError) throw rowsError;
  const byId = new Map((rows ?? []).map(v => [v.id, v as Vacancy]));
  return ids.map(id => byId.get(id)).filter((v): v is Vacancy => Boolean(v));
}
