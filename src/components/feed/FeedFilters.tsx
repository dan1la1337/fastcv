import SearchSelect, { type SelectOption } from "@/components/SearchSelect";
import { AREAS, DIRECTIONS, LEVELS, SOURCES, WORK_FORMATS, type VacancyFilters } from "@/lib/vacancies";
import { toggled } from "@/lib/feed-filters";

const chip = (active: boolean) =>
  `text-xs px-3 py-1.5 rounded-full transition-colors ${active
    ? "lg lg-on"
    : "lg text-neutral-300 hover:text-neutral-100"}`;

/** Боковая колонка фильтров ленты. На телефоне свёрнута, пока не нажата кнопка фильтров. */
export default function FeedFilters({ filters, setFilters, open, cityOptions, countryOptions, chooseCountry }: {
  filters: VacancyFilters;
  setFilters: (update: (f: VacancyFilters) => VacancyFilters) => void;
  open: boolean;
  cityOptions: SelectOption[];
  countryOptions: SelectOption[];
  chooseCountry: (value: string) => void;
}) {
  const { area, formats, sources, minSalary, withSalary: onlyWithSalary, city, country, levels: selectedLevels, stack: selectedStack } = filters;
  const selectedDirection = filters.direction || null;
  const direction = DIRECTIONS.find(d => d.id === selectedDirection);
  const showLevels = selectedLevels.length > 0 || (area !== "work" && direction?.group !== "work");
  return (
    <aside className={`lg:col-start-1 lg:row-start-1 lg:row-span-2 space-y-6 ${open ? "" : "hidden"} lg:block`}>
      <div className="neu-sub rounded-3xl p-5 space-y-6">
        {/* Направление и уточнение по технологиям — главное для кандидата */}
        <div className="space-y-3">
          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Направление</label>

          <SearchSelect label="Направление" placeholder="Например: frontend, маркетинг, React…" emptyLabel="Все направления"
            options={AREAS.filter(a => !area || a.id === area).flatMap(a => DIRECTIONS.filter(d => d.group === a.id).map(d => ({
              value: d.id, label: d.label, group: a.label, keywords: d.tech,
            })))}
            value={selectedDirection ?? ""}
            onChange={v => setFilters(f => ({ ...f, direction: v, stack: [] }))} />

          {direction?.tech && (
            <div className="pt-1">
              <p className="text-xs text-neutral-500 mb-2">Уточнить по технологиям (можно несколько):</p>
              <div className="flex flex-wrap gap-2">
                {direction.tech.map(tech => (
                  <button key={tech} onClick={() => setFilters(f => ({ ...f, stack: toggled(f.stack, tech) }))} className={chip(selectedStack.includes(tech))} aria-pressed={selectedStack.includes(tech)}>
                    {tech}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Уровень — грейды есть в IT и digital; для «других профессий» не показываем */}
        {showLevels && (<div className="space-y-3 pt-2 border-t border-white/[0.08]">
          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Уровень</label>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map(l => (
              <button key={l.id} onClick={() => setFilters(f => ({ ...f, levels: toggled(f.levels, l.id) }))} className={chip(selectedLevels.includes(l.id))} aria-pressed={selectedLevels.includes(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>)}

        {/* Формат работы */}
        <div className="space-y-3 pt-2 border-t border-white/[0.08]">
          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Формат</label>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilters(f => ({ ...f, formats: [] }))} className={chip(formats.length === 0)} aria-pressed={formats.length === 0}>Любой</button>
            {WORK_FORMATS.map(f => (
              <button key={f.id}
                onClick={() => setFilters(s => ({ ...s, formats: toggled(s.formats, f.id) }))}
                className={chip(formats.includes(f.id))} aria-pressed={formats.includes(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Город */}
        <div className="space-y-3 pt-2 border-t border-white/[0.08]">
          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Город</label>
          <SearchSelect label="Город" placeholder="Начните вводить город…" emptyLabel="Любой город"
            options={cityOptions} value={city} onChange={v => setFilters(f => ({ ...f, city: v }))} />
        </div>
        {/* Ползунок зарплаты и чекбокс */}
        <div className="space-y-4 pt-2 border-t border-white/[0.08]">
          <div className="flex items-center justify-between">
            <label htmlFor="feed-salary" className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Зарплата от</label>
            <span className="text-xs font-semibold text-teal-200 transition-all duration-200">
              {minSalary === 0 ? "Любая" : `${minSalary.toLocaleString("ru-RU")} ₽`}
            </span>
          </div>

          <div className="space-y-2">
            <input
              id="feed-salary"
              type="range"
              min={0}
              max={500000}
              step={25000}
              value={minSalary}
              onChange={(e) => { const value = Number(e.target.value); setFilters(f => ({ ...f, minSalary: value })); }}
              className="w-full appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-neutral-500 tabular-nums">
              <span>0 ₽</span>
              <span>250k</span>
              <span>500k+</span>
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer pt-1 select-none text-xs text-neutral-300 hover:text-neutral-100 transition-colors">
            <input type="checkbox" checked={onlyWithSalary} onChange={e => { const checked = e.target.checked; setFilters(f => ({ ...f, withSalary: checked })); }} />
            Только с указанной зарплатой
          </label>
        </div>

        {/* Страна */}
        <div className="space-y-3 pt-2 border-t border-white/[0.08]">
          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Страна</label>
          <SearchSelect label="Страна" placeholder="Начните вводить страну…" emptyLabel="Все страны"
            options={countryOptions} value={country} onChange={chooseCountry} />
        </div>

        {/* Источник */}
        <div className="space-y-3 pt-2 border-t border-white/[0.08]">
          <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Источник</label>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilters(f => ({ ...f, sources: [] }))} className={chip(sources.length === 0)} aria-pressed={sources.length === 0}>Все</button>
            {SOURCES.map(s => (
              <button key={s.id}
                onClick={() => setFilters(f => ({ ...f, sources: toggled(f.sources, s.id) }))}
                className={chip(sources.includes(s.id))} aria-pressed={sources.includes(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

      </div>
    </aside>
  );
}
