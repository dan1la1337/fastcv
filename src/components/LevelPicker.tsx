"use client";

import { Sparkles } from "lucide-react";
import { LEVELS, type Level } from "@/lib/vacancies";

/**
 * Уровень (грейд) кандидата. Не считается из лет опыта: его выбирает кандидат или
 * предлагает ИИ по резюме — с объяснением, почему такой и что добавить в резюме.
 */
export default function LevelPicker({ level, source, reason, onChange, labelClass }: {
  level: Level | "";
  source: "ai" | "manual" | null;
  reason: string | null;
  onChange: (level: Level | "") => void;
  labelClass: string;
}) {
  const chip = (active: boolean) =>
    `text-sm px-3.5 py-1.5 rounded-full border transition-colors ${active
      ? "bg-teal-300 border-teal-300 text-neutral-950"
      : "bg-white/[0.04] border-white/15 text-neutral-300 hover:border-white/30"}`;
  return (
    <div>
      <span className={labelClass}>Уровень</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Уровень">
        {LEVELS.map(l => (
          <button key={l.id} type="button" aria-pressed={level === l.id}
            onClick={() => onChange(level === l.id ? "" : l.id)} className={chip(level === l.id)}>
            {l.label}
          </button>
        ))}
      </div>
      {reason ? (
        <div className="mt-3 rounded-2xl border border-indigo-400/25 bg-indigo-400/[0.05] p-3 text-sm space-y-1" aria-label="Почему такой уровень">
          <p className="text-xs text-indigo-200 inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            {source === "ai" ? "Оценка ИИ по резюме" : "ИИ оценивал по резюме иначе — вы выбрали уровень сами"}
          </p>
          <p className="text-neutral-300 whitespace-pre-line leading-relaxed">{reason}</p>
        </div>
      ) : (
        <p className="text-xs text-neutral-500 mt-2">
          Уровень — это не только годы: задачи, самостоятельность, масштаб проектов. Загрузите резюме — ИИ оценит уровень и объяснит почему.
        </p>
      )}
    </div>
  );
}
