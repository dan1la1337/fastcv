// ИИ-разбор отказа: формат разбора и его проверка.

export type RejectionAnalysis = {
  summary: string;
  reasons: string[];
  strengths: string[];
  gaps: string[];
  letter: string;
  next: string[];
  /** совпадение профиля с вакансией на момент разбора */
  match?: number | null;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown, n: number) =>
  Array.isArray(v) ? v.map(x => str(x, 300)).filter(Boolean).slice(0, n) : [];

/** Ответ модели → проверенный разбор или null. */
export function toAnalysis(raw: unknown, match: number | null): RejectionAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const summary = str(r.summary, 400);
  const reasons = list(r.reasons, 3);
  const next = list(r.next, 3);
  if (!summary || !reasons.length || !next.length) return null;
  return { summary, reasons, strengths: list(r.strengths, 3), gaps: list(r.gaps, 4), letter: str(r.letter, 500), next, match };
}
