"use client";

import { LEVELS, levelForExperience } from "@/lib/vacancies";

/**
 * Опыт работы вместо выбора уровня: кандидат указывает годы, грейд считается по шкале
 * FastCV (до 2 лет — junior, 2–5 — middle, от 5 — senior), «руковожу людьми» — lead.
 */
export default function ExperienceInput({ years, leads, onChange, labelClass }: {
  years: string;
  leads: boolean;
  onChange: (years: string, leads: boolean) => void;
  labelClass: string;
}) {
  const value = Number(years.replace(",", "."));
  const valid = years.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 60;
  const level = valid ? LEVELS.find(l => l.id === levelForExperience(value, leads))?.label : null;

  return (
    <div>
      <label htmlFor="experience-years" className={labelClass}>Опыт работы по специальности</label>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <input id="experience-years" type="number" inputMode="decimal" min={0} max={60} step={0.5}
            value={years} onChange={e => onChange(e.target.value, leads)} placeholder="0"
            className="w-24 pl-3 pr-10 py-2.5 bg-neutral-950 border border-neutral-800 rounded-lg text-sm text-neutral-100 focus:outline-none focus:border-teal-300" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500">лет</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
          <input type="checkbox" checked={leads} onChange={e => onChange(years, e.target.checked)}
            className="w-4 h-4 rounded bg-neutral-950 border-neutral-700" />
          Руковожу людьми
        </label>
      </div>
      <p className="text-xs text-neutral-500 mt-2">
        {level ? <>Ваш уровень: <span className="text-neutral-200 font-medium">{level}</span> · </> : null}
        до 2 лет — Junior, 2–5 — Middle, от 5 — Senior
      </p>
    </div>
  );
}
