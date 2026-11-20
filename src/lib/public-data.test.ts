import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// unstable_cache подменён: запоминаем ключ и срок, функцию вызываем напрямую
const cached = vi.hoisted(() => [] as { keys: string[]; revalidate: number | false | undefined }[]);
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown, keys: string[], options: { revalidate?: number | false }) => {
    cached.push({ keys, revalidate: options.revalidate });
    return fn;
  },
}));

const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/supabase", () => {
  const query = {
    select: () => query, is: () => query, eq: () => query, ilike: (_: string, v: string) => { calls.push(`ilike ${v}`); return query; },
    order: () => query, limit: () => Promise.resolve({ data: [{ id: "v1" }] }),
    range: (from: number, to: number) => {
      calls.push(`range ${from}-${to}`);
      // Страница из 61 строки: 60 на экран, лишняя — признак следующей страницы
      const rows = Array.from({ length: from === 0 ? 61 : 3 }, (_, i) => ({ id: `v${from + i}` }));
      return Promise.resolve({ data: rows, count: 123 });
    },
    then: (resolve: (v: unknown) => void) => resolve({ data: [{ direction: "backend", vacancies: 7 }] }),
  };
  return {
    supabase: {
      from: (table: string) => { calls.push(`from ${table}`); return query; },
      rpc: (fn: string) => { calls.push(`rpc ${fn}`); return Promise.resolve({ data: null }); },
    },
  };
});

const data = await import("@/lib/public-data");

describe("публичные данные страниц в кэше Next.js", () => {
  beforeEach(() => { calls.length = 0; });

  it("каждая выборка в кэше со сроком прежнего revalidate страницы и своим ключом", () => {
    expect(cached.map(c => [c.keys[0], c.revalidate])).toEqual([
      ["public:home-feed", 300],
      ["public:live-stats", 300],
      ["public:direction-counts", 1800],
      ["public:direction-page", 1800],
      ["public:company-page", 1800],
      ["public:company-rating", 1800],
    ]);
  });

  it("в кэш идёт только анонимный клиент: без cookies, заголовков и серверной сессии", () => {
    const source = readFileSync("src/lib/public-data.ts", "utf8");
    expect(source).not.toMatch(/next\/headers|supabase-server|cookies\(|headers\(/);
    expect(source).toMatch(/from "@\/lib\/supabase"/);
  });

  it("выборки возвращают данные базы", async () => {
    expect(await data.cachedDirectionCounts()).toEqual({ backend: 7 });
    const first = await data.cachedDirectionVacancies("backend");
    expect([first.vacancies.length, first.vacancies[0].id, first.hasNext, first.total]).toEqual([60, "v0", true, null]);
    expect(calls).toContain("range 0-60");
    const third = await data.cachedDirectionVacancies("backend", 3);
    expect([third.vacancies.length, third.vacancies[0].id, third.hasNext]).toEqual([3, "v120", false]);
    expect(calls).toContain("range 120-180");
    const company = await data.cachedCompanyVacancies("50%_off", 2);
    expect([company.vacancies.length, company.hasNext, company.total]).toEqual([3, false, 123]);
    expect(calls).toContain("ilike 50\\%\\_off");
    expect(await data.cachedCompanyVacancies("")).toEqual({ vacancies: [], hasNext: false, total: 0 });
    expect(await data.cachedCompanyRating("Acme")).toBeNull();
    expect(calls).toContain("rpc company_rating");
  });
});
