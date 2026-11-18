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
      ["public:direction-vacancies", 1800],
      ["public:company-vacancies", 1800],
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
    expect(await data.cachedDirectionVacancies("backend")).toEqual([{ id: "v1" }]);
    expect(await data.cachedCompanyVacancies("50%_off")).toEqual([{ id: "v1" }]);
    expect(calls).toContain("ilike 50\\%\\_off");
    expect(await data.cachedCompanyVacancies("")).toEqual([]);
    expect(await data.cachedCompanyRating("Acme")).toBeNull();
    expect(calls).toContain("rpc company_rating");
  });
});
