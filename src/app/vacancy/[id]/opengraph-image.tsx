import { supabase } from "@/lib/supabase";
import { formatLabel, formatSalary, levelLabel } from "@/lib/vacancies";
import { OG_SIZE, ogCard } from "@/lib/og";

export const alt = "Вакансия на FastCV";
export const size = OG_SIZE;
export const contentType = "image/png";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Картинка для репоста вакансии: должность, компания, зарплата, город и формат. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: v } = UUID.test(id)
    ? await supabase
        .from("vacancies")
        .select("title, company_name, salary_min, salary_max, salary_currency, level, city, work_format, is_remote")
        .eq("id", id)
        .maybeSingle()
    : { data: null };
  if (!v) return ogCard({ kicker: "Вакансия", title: "Вакансии с откликом от ИИ", facts: [] });

  const remote = v.work_format === "remote" || (!v.work_format && v.is_remote);
  const facts = [
    v.salary_min || v.salary_max ? formatSalary(v.salary_min, v.salary_max, v.salary_currency) : null,
    v.level ? levelLabel(v.level) : null,
    v.city,
    remote ? "удалённо" : formatLabel(v.work_format)?.toLowerCase(),
  ].filter((f): f is string => Boolean(f));
  return ogCard({ kicker: v.company_name?.trim() || "Вакансия", title: v.title, facts });
}
