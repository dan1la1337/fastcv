import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";

const SITE = "https://fastcv.ru";

// Карта сайта пересобирается раз в час: вакансии появляются каждые 6 часов
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabase
    .from("vacancies")
    .select("id, created_at, posted_at")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(5000);

  return [
    { url: SITE, changeFrequency: "hourly", priority: 1 },
    ...(data ?? []).map(v => ({
      url: `${SITE}/vacancy/${v.id}`,
      lastModified: v.posted_at ?? v.created_at ?? undefined,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
