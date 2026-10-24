import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";
import { DIRECTIONS } from "@/lib/vacancies";

const SITE = "https://fastcv.ru";

// Карта сайта пересобирается раз в час: вакансии появляются каждые 2 часа.
// Вакансии «Работы России» и SuperJob не включаем: живут недолго и закрыты от индексации.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabase
    .from("vacancies")
    .select("id, created_at, posted_at, company_name")
    .is("archived_at", null)
    .not("source_post", "like", "trudvsem/%")
    .not("source_post", "like", "superjob/%")
    .order("created_at", { ascending: false })
    .limit(5000);

  // Компании с открытыми вакансиями — у каждой своя страница
  const companies = [...new Set((data ?? []).map(v => v.company_name?.trim()).filter((n): n is string => Boolean(n)))].slice(0, 1000);

  return [
    { url: SITE, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE}/jobs`, changeFrequency: "daily", priority: 0.8 },
    ...DIRECTIONS.map(d => ({ url: `${SITE}/jobs/${d.id.replace("_", "-")}`, changeFrequency: "daily" as const, priority: 0.8 })),
    ...companies.map(name => ({ url: `${SITE}/company/${encodeURIComponent(name)}`, changeFrequency: "daily" as const, priority: 0.5 })),
    ...(data ?? []).map(v => ({
      url: `${SITE}/vacancy/${v.id}`,
      lastModified: v.posted_at ?? v.created_at ?? undefined,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
