import { AREAS, DIRECTIONS, SOURCES, formatLabel, levelLabel, type Area, type Vacancy, type VacancyFilters } from "@/lib/vacancies";
import type { MarkKind } from "@/lib/marks";
import type { SelectOption } from "@/components/SearchSelect";

/** Чистая логика ленты: фильтры, списки для выбора, отметки. Без React и без запросов. */

export interface CityRow { city: string; country: string | null; vacancies: number }
export interface CountryRow { country: string; vacancies: number }

/** Добавляет значение в список или убирает, если оно уже там. */
export function toggled<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter(x => x !== item) : [...list, item];
}

/** Дописывает к списку новые строки без повторов по id. */
export function mergeById<T extends { id: string }>(prev: T[], rows: T[]): T[] {
  return [...prev, ...rows.filter(r => !prev.some(p => p.id === r.id))];
}

/** id вакансий, которые пользователь скрыл. */
export function hiddenIds(marks: Map<string, MarkKind>): string[] {
  return [...marks].filter(([, kind]) => kind === "hidden").map(([id]) => id);
}

/** Страны для фильтра: Россия первой, остальные в порядке строк (по числу вакансий). */
export function countryOptions(rows: CountryRow[]): SelectOption[] {
  return [...rows]
    .sort((a, b) => Number(b.country === "Россия") - Number(a.country === "Россия"))
    .map(c => ({ value: c.country, label: c.country, count: c.vacancies }));
}

/** Выбрана страна — в списке городов только её города. */
export function cityOptions(cities: CityRow[], country: string): SelectOption[] {
  return cities
    .filter(c => !country || c.country === country)
    .map(c => ({ value: c.city, label: c.city, count: c.vacancies }));
}

/** Страна; город из другой страны сбрасываем. */
export function withCountry(f: VacancyFilters, value: string, cities: CityRow[]): VacancyFilters {
  const keepCity = !(value && f.city && !cities.some(c => c.city === f.city && c.country === value));
  return { ...f, country: value, city: keepCity ? f.city : "" };
}

/** Раздел ленты; направление из другого раздела сбрасываем, иначе лента окажется пустой. */
export function withArea(f: VacancyFilters, next: Area | ""): VacancyFilters {
  if (next && f.direction && DIRECTIONS.find(d => d.id === f.direction)?.group !== next) {
    return { ...f, area: next, direction: "", stack: [] };
  }
  return { ...f, area: next };
}

export interface ActiveFilter {
  key: string;
  label: string;
  /** Снимает это условие. Применяется через setState(updater), поэтому несколько подряд складываются. */
  clear: (f: VacancyFilters) => VacancyFilters;
}

/** Что сейчас сужает ленту: показываем над результатами, каждое условие снимается по клику. */
export function activeFilters(f: VacancyFilters): ActiveFilter[] {
  return [
    f.search.trim() && { key: "search", label: `«${f.search.trim()}»`, clear: (s: VacancyFilters) => ({ ...s, search: "" }) },
    f.area && { key: "area", label: AREAS.find(a => a.id === f.area)?.label ?? f.area, clear: (s: VacancyFilters) => ({ ...s, area: "" as const }) },
    f.direction && { key: "direction", label: DIRECTIONS.find(d => d.id === f.direction)?.label ?? f.direction, clear: (s: VacancyFilters) => ({ ...s, direction: "", stack: [] }) },
    ...f.levels.map(l => ({ key: `level-${l}`, label: levelLabel(l) ?? l, clear: (s: VacancyFilters) => ({ ...s, levels: s.levels.filter(x => x !== l) }) })),
    ...f.formats.map(w => ({ key: `format-${w}`, label: formatLabel(w) ?? w, clear: (s: VacancyFilters) => ({ ...s, formats: s.formats.filter(x => x !== w) }) })),
    f.city.trim() && { key: "city", label: f.city, clear: (s: VacancyFilters) => ({ ...s, city: "" }) },
    f.country && { key: "country", label: f.country, clear: (s: VacancyFilters) => ({ ...s, country: "" }) },
    f.minSalary > 0 && { key: "salary", label: `от ${f.minSalary.toLocaleString("ru-RU")} ₽`, clear: (s: VacancyFilters) => ({ ...s, minSalary: 0 }) },
    f.withSalary && { key: "with-salary", label: "С зарплатой", clear: (s: VacancyFilters) => ({ ...s, withSalary: false }) },
    ...f.sources.map(id => ({ key: `source-${id}`, label: SOURCES.find(x => x.id === id)?.label ?? id, clear: (s: VacancyFilters) => ({ ...s, sources: s.sources.filter(x => x !== id) }) })),
  ].filter((x): x is ActiveFilter => !!x);
}

/** Отметки после переключения: тот же вид ещё раз снимает отметку. */
export function nextMark(marks: Map<string, MarkKind>, id: string, kind: MarkKind): MarkKind | null {
  return marks.get(id) === kind ? null : kind;
}

/** Список избранного или скрытых после смены отметки вакансии: она наверху или убрана. */
export function withMarked(list: Vacancy[], item: Vacancy, inList: boolean): Vacancy[] {
  const rest = list.filter(v => v.id !== item.id);
  return inList ? [item, ...rest] : rest;
}
