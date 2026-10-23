/** Черновик профиля, который ИИ собрал из PDF-резюме (POST /api/resume-autofill). */
export interface ResumeDraft {
  name: string | null;
  about: string | null;
  skills: string[];
  level: string | null;
  directions: string[];
  city: string | null;
  salary: number | null;
}
