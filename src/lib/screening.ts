// ИИ-скрининг отклика для работодателя: формат вердикта и его проверка.

export type Fit = "strong" | "maybe" | "weak";
export type Screening = { fit: Fit; headline: string; pros: string[]; cons: string[]; ask: string };

export const FIT_LABEL: Record<Fit, string> = { strong: "Сильный кандидат", maybe: "Возможно подходит", weak: "Слабое совпадение" };
export const FIT_STYLE: Record<Fit, string> = {
  strong: "bg-emerald-400/15 text-emerald-200 border-emerald-400/40",
  maybe: "bg-amber-300/10 text-amber-200 border-amber-300/40",
  weak: "bg-white/[0.06] text-neutral-400 border-white/15",
};
export const FIT_ORDER: Record<Fit, number> = { strong: 0, maybe: 1, weak: 2 };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown, n: number) => (Array.isArray(v) ? v.map(x => str(x, 250)).filter(Boolean).slice(0, n) : []);

export function toScreening(raw: unknown): Screening | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fit = r.fit === "strong" || r.fit === "maybe" || r.fit === "weak" ? r.fit : null;
  const headline = str(r.headline, 200);
  if (!fit || !headline) return null;
  return { fit, headline, pros: list(r.pros, 3), cons: list(r.cons, 3), ask: str(r.ask, 300) };
}
