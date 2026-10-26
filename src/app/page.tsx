import Feed from "@/components/Feed";
import Hero from "@/components/Hero";
import { fetchLiveStats, type LiveStats } from "@/lib/live";
import { DEFAULT_FILTERS, fetchVacancyPage, type Vacancy } from "@/lib/vacancies";

// Первая страница ленты собирается на сервере и кэшируется на 5 минут:
// главная открывается сразу с вакансиями, а поисковики видят их в HTML.
export const revalidate = 300;

export default async function Home() {
  let rows: Vacancy[] | null = null;
  let total = 0;
  let stats: LiveStats | null = null;
  try {
    ({ rows, total } = await fetchVacancyPage(DEFAULT_FILTERS, 0));
  } catch (error) {
    // База недоступна при сборке или запросе — лента загрузится уже в браузере
    console.error("Feed prefetch failed", error);
  }
  try {
    stats = await fetchLiveStats();
  } catch {
    // без счётчика первый экран всё равно открывается
  }
  // В карточке ленты видно три строки описания: остальное не везём в HTML первой страницы
  const light = rows?.map(r => ({ ...r, description: r.description && r.description.length > 320 ? r.description.slice(0, 320) + "…" : r.description })) ?? null;
  return <Feed initialRows={light} initialTotal={total} hero={<Hero stats={stats} />} />;
}
