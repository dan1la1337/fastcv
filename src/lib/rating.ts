// Рейтинг работодателя: данные функции company_rating и подписи к ним.
import { plural } from "@/lib/vacancies";

export type PublicReview = {
  id: string;
  stage: "applied" | "interview" | string;
  rating: number;
  pros?: string;
  cons?: string;
  reply?: string;
  replied_at?: string;
  created_at: string;
  who?: string;
};

export type CompanyRating = {
  score?: number;
  verified?: boolean;
  reply_rate?: number;
  reply_hours?: number;
  reply_trend?: number;
  applications?: number;
  interview_rating?: number;
  interview_ratings?: number;
  review_rating?: number;
  reviews_count?: number;
  distribution?: number[];
  open_vacancies?: number;
  reported_vacancies?: number;
  summary?: string;
  reviews?: PublicReview[];
};

/** «за 5 ч» / «за 2 дня». */
export function hoursLabel(hours: number): string {
  if (hours < 24) return `за ${hours} ч`;
  const days = Math.round(hours / 24);
  return `за ${days} ${plural(days, ["день", "дня", "дней"])}`;
}

/** Словесная оценка итогового балла. */
export function scoreLabel(score: number): string {
  if (score >= 85) return "Отличный процесс найма";
  if (score >= 70) return "Хороший процесс найма";
  if (score >= 50) return "Средний процесс найма";
  return "Процесс найма с проблемами";
}

export const stageLabel = (stage: string) => (stage === "interview" ? "Был на собеседовании" : "Откликался");
