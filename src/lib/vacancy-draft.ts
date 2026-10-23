/** Черновик вакансии, который ИИ пишет по заметкам работодателя (POST /api/vacancy-draft). */
export interface VacancyDraft {
  title: string;
  description: string;
  stack: string[];
  salary_min: number | null;
  salary_max: number | null;
  city: string | null;
  is_remote: boolean;
}
