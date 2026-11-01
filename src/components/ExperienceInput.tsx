"use client";

/**
 * Опыт работы и «руковожу людьми». Это факты о кандидате, а не грейд: уровень
 * выбирается отдельно (LevelPicker) — сам или по оценке ИИ из резюме.
 */
export default function ExperienceInput({ years, leads, onChange, labelClass }: {
  years: string;
  leads: boolean;
  onChange: (years: string, leads: boolean) => void;
  labelClass: string;
}) {
  return (
    <div>
      <label htmlFor="experience-years" className={labelClass}>Опыт работы по специальности</label>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <input id="experience-years" type="number" inputMode="decimal" min={0} max={60} step={0.5}
            value={years} onChange={e => onChange(e.target.value, leads)} placeholder="0"
            className="neu-in w-24 pl-3 pr-10 py-2.5 rounded-xl text-sm text-neutral-100" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500">лет</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-300 cursor-pointer">
          <input type="checkbox" checked={leads} onChange={e => onChange(years, e.target.checked)}
            className="neu-in w-4 h-4 rounded" />
          Руковожу людьми
        </label>
      </div>
      <p className="text-xs text-neutral-500 mt-2">Сколько лет вы работаете по профессии — по этому сравниваем с требованиями вакансий к опыту.</p>
    </div>
  );
}
