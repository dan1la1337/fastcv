import { supabase } from "@/lib/supabase";
import { plural } from "@/lib/vacancies";
import { OG_SIZE, ogCard } from "@/lib/og";

export const alt = "Компания на FastCV";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Картинка для репоста страницы компании: название и число открытых вакансий. */
export default async function Image({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name).trim().slice(0, 200);
  // Как на странице компании: название без учёта регистра, % и _ — не шаблоны
  const { data, count } = name
    ? await supabase
        .from("vacancies")
        .select("company_name", { count: "exact" })
        .is("archived_at", null)
        .ilike("company_name", name.replace(/[%_\\]/g, "\\$&"))
        .limit(1)
    : { data: null, count: 0 };
  const company = data?.[0]?.company_name ?? name;
  const facts = count ? [`${count} ${plural(count, ["открытая вакансия", "открытые вакансии", "открытых вакансий"])}`] : [];
  return ogCard({ kicker: "Вакансии компании", title: company || "FastCV", facts });
}
