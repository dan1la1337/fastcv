import { describe, expect, it, vi } from "vitest";

// vacancies.ts тянет клиент Supabase; чистой логике ленты он не нужен
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { DEFAULT_FILTERS, type Vacancy, type VacancyFilters } from "@/lib/vacancies";
import {
  activeFilters, cityOptions, countryOptions, hiddenIds, mergeById, nextMark, toggled, withArea, withCountry, withMarked,
} from "@/lib/feed-filters";
import type { MarkKind } from "@/lib/marks";

const filters = (patch: Partial<VacancyFilters> = {}): VacancyFilters => ({ ...DEFAULT_FILTERS, ...patch });
const cities = [
  { city: "Москва", country: "Россия", vacancies: 10 },
  { city: "Минск", country: "Беларусь", vacancies: 3 },
];

describe("toggled и mergeById", () => {
  it("toggled добавляет и убирает значение", () => {
    expect(toggled(["a"], "b")).toEqual(["a", "b"]);
    expect(toggled(["a", "b"], "a")).toEqual(["b"]);
  });

  it("mergeById не дублирует строки", () => {
    expect(mergeById([{ id: "1" }, { id: "2" }], [{ id: "2" }, { id: "3" }]).map(r => r.id)).toEqual(["1", "2", "3"]);
  });
});

describe("отметки", () => {
  const marks = new Map<string, MarkKind>([["a", "hidden"], ["b", "saved"], ["c", "hidden"]]);

  it("hiddenIds — только скрытые", () => {
    expect(hiddenIds(marks)).toEqual(["a", "c"]);
  });

  it("nextMark: тот же вид снимает отметку, другой ставит", () => {
    expect(nextMark(marks, "b", "saved")).toBeNull();
    expect(nextMark(marks, "b", "hidden")).toBe("hidden");
    expect(nextMark(marks, "x", "saved")).toBe("saved");
  });

  it("withMarked ставит вакансию наверх или убирает", () => {
    const v = (id: string) => ({ id }) as Vacancy;
    expect(withMarked([v("1"), v("2")], v("2"), true).map(x => x.id)).toEqual(["2", "1"]);
    expect(withMarked([v("1"), v("2")], v("2"), false).map(x => x.id)).toEqual(["1"]);
  });
});

describe("страны и города", () => {
  it("Россия первой, остальные в исходном порядке", () => {
    const rows = [{ country: "Беларусь", vacancies: 5 }, { country: "Казахстан", vacancies: 4 }, { country: "Россия", vacancies: 1 }];
    expect(countryOptions(rows).map(o => o.value)).toEqual(["Россия", "Беларусь", "Казахстан"]);
  });

  it("города выбранной страны", () => {
    expect(cityOptions(cities, "Россия").map(o => o.value)).toEqual(["Москва"]);
    expect(cityOptions(cities, "")).toHaveLength(2);
  });

  it("смена страны сбрасывает город другой страны и сохраняет свой", () => {
    expect(withCountry(filters({ city: "Москва" }), "Беларусь", cities)).toMatchObject({ country: "Беларусь", city: "" });
    expect(withCountry(filters({ city: "Москва" }), "Россия", cities)).toMatchObject({ country: "Россия", city: "Москва" });
    expect(withCountry(filters({ city: "Москва", country: "Россия" }), "", cities)).toMatchObject({ country: "", city: "Москва" });
  });
});

describe("withArea", () => {
  it("направление из другого раздела сбрасывается вместе со стеком", () => {
    const f = filters({ direction: "backend", stack: ["Go"] });
    expect(withArea(f, "it")).toMatchObject({ area: "it", direction: "backend", stack: ["Go"] });
    const other = withArea(f, "other");
    expect(other).toMatchObject({ direction: "", stack: [] });
  });
});

describe("activeFilters", () => {
  it("пустые фильтры — ничего", () => {
    expect(activeFilters(filters())).toEqual([]);
  });

  it("каждое условие снимается своим clear, подряд складываются", () => {
    const f = filters({ search: " python ", levels: ["junior", "middle"], minSalary: 100000, withSalary: true });
    const active = activeFilters(f);
    expect(active.map(a => a.key)).toEqual(["search", "level-junior", "level-middle", "salary", "with-salary"]);
    expect(active[0].label).toBe("«python»");
    const cleared = active.reduce((s, a) => a.clear(s), f);
    expect(activeFilters(cleared)).toEqual([]);
  });
});
