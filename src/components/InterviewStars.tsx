"use client";

import { Star } from "lucide-react";

/** Оценка собеседования 1–5 звёздами (рейтинг найма, план 1.13). */
export default function InterviewStars({ value, onRate, disabled }: {
  value: number | null;
  onRate: (rating: number) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Оценка собеседования" className="inline-flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} из 5`}
          disabled={disabled} onClick={() => onRate(n)}
          className="p-1 rounded-full hover:bg-white/[0.08] disabled:opacity-50 transition-colors">
          <Star className={`w-6 h-6 ${value !== null && n <= value ? "fill-amber-300 text-amber-300" : "text-neutral-500"}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
