import { describe, expect, it, vi } from "vitest";

// Процент совпадения считает база (vacancy_match, проверки в tests/db); здесь — разбор её ответа
// на клиенте и запросы к ней.
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

const { fetchMatches, matchTone, toMatch } = await import("@/lib/matching");

describe("toMatch", () => {
  it("splits missing into plain skills and related ones", () => {
    const match = toMatch({
      score: 72,
      matched: ["Python", 5, null, "Django"],
      missing: ["Kafka", { skill: "PostgreSQL", via: "MySQL" }, { skill: "Redis" }],
      core: { fit: "related", stack: ["Kotlin", 1] },
    });
    expect(match).toEqual({
      score: 72,
      matched: ["Python", "Django"],
      missing: ["Kafka"],
      related: [{ skill: "PostgreSQL", via: "MySQL" }],
      core: { fit: "related", stack: ["Kotlin"] },
    });
  });

  it.each([[undefined], [null], ["match"], [{ fit: "maybe", stack: [] }], [{ stack: ["Java"] }]])(
    "drops unknown core %j",
    core => {
      expect(toMatch({ score: 10, matched: null, missing: "x", core }).core).toBeNull();
    },
  );

  it("tolerates non-array lists", () => {
    expect(toMatch({ score: 0, matched: "Python", missing: { skill: "Go" } })).toMatchObject({ matched: [], missing: [], related: [] });
  });
});

describe("matchTone", () => {
  it.each([
    [100, "teal"], [75, "teal"], [74, "indigo"], [50, "indigo"], [49, "neutral"], [0, "neutral"],
  ])("score %i → %s", (score, tone) => {
    expect(matchTone(score)).toContain(tone);
  });
});

describe("fetchMatches", () => {
  it("does not call the database without ids", async () => {
    rpc.mockClear();
    expect(await fetchMatches([])).toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks for at most 100 vacancies and keys the result by id", async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: "a", score: 90, matched: ["Go"], missing: [], core: null }], error: null });
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const result = await fetchMatches(ids);
    expect(rpc).toHaveBeenCalledWith("my_vacancy_matches", { ids: ids.slice(0, 100) });
    expect(result).toEqual({ a: { score: 90, matched: ["Go"], missing: [], related: [], core: null } });
  });

  it("throws database errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    await expect(fetchMatches(["a"])).rejects.toThrow("boom");
  });
});
