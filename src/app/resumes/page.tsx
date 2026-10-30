import type { Metadata } from "next";
import ResumeBoard from "./ResumeBoard";

export const metadata: Metadata = { title: "База резюме — FastCV", robots: { index: false } };

/** База резюме для работодателей: кандидаты, открывшие профиль, с фильтрами и чатом. */
export default function ResumesPage() {
  return <ResumeBoard />;
}
