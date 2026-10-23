import Feed from "@/components/Feed";
import { DEFAULT_FILTERS, fetchVacancyPage, type Vacancy } from "@/lib/vacancies";

// Первая страница ленты собирается на сервере и кэшируется на 5 минут:
// главная открывается сразу с вакансиями, а поисковики видят их в HTML.
export const revalidate = 300;

export default async function Home() {
  let rows: Vacancy[] | null = null;
  let total = 0;
  try {
    ({ rows, total } = await fetchVacancyPage(DEFAULT_FILTERS, 0));
  } catch (error) {
    // База недоступна при сборке или запросе — лента загрузится уже в браузере
    console.error("Feed prefetch failed", error);
  }
  return <Feed initialRows={rows} initialTotal={total} />;
}
