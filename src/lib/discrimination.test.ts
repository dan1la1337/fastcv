import { describe, expect, it } from "vitest";
import rules from "../../discrimination-rules.json";
import { BLOCKING_FLAGS, DISCRIMINATION_FLAGS, discriminationFlags, findDiscrimination, isBlocked } from "@/lib/discrimination";

describe("discrimination-rules.json examples", () => {
  for (const [flag, rule] of Object.entries(rules.flags)) {
    it.each(rule.examples.match)(`${flag}: flags %j`, text => {
      expect(discriminationFlags(text)).toContain(flag);
    });
    it.each(rule.examples.no_match)(`${flag}: does not flag %j`, text => {
      expect(discriminationFlags(text)).not.toContain(flag);
    });
  }
});

describe("findDiscrimination", () => {
  it("flags the cases named in КоАП 13.11.1 checks", () => {
    expect(discriminationFlags("Ищем менеджера до 35 лет")).toEqual(["age"]);
    expect(discriminationFlags("Только мужчины, график 5/2")).toEqual(["sex"]);
    expect(discriminationFlags("Продавец славянской внешности")).toEqual(["nationality"]);
    expect(discriminationFlags("граждане РФ only")).toEqual(["citizenship"]);
  });

  it("returns every flag once, in rule order, with the matched fragment", () => {
    const found = findDiscrimination("Гражданство РФ. Требуется девушка до 30 лет, славянской внешности. Девушка до 25 лет");
    expect(found.map(f => f.flag)).toEqual(["age", "sex", "nationality", "citizenship"]);
    expect(found[0]).toMatchObject({ flag: "age", label: "возраст", block: true, match: "до 30 лет" });
    expect(found[1].match).toBe("Требуется девушка");
  });

  it("skips an age range that is about experience but still finds a real one later", () => {
    expect(discriminationFlags("Опыт от 10 до 15 лет")).toEqual([]);
    expect(discriminationFlags("Опыт от 10 до 15 лет. Кандидаты до 40 лет")).toEqual(["age"]);
  });

  it("handles an empty or clean text", () => {
    expect(findDiscrimination(null)).toEqual([]);
    expect(discriminationFlags("Python-разработчик в команду платежей, удалёнка")).toEqual([]);
  });
});

describe("blocking", () => {
  it("hides age, sex and nationality; citizenship is flag-only", () => {
    expect(DISCRIMINATION_FLAGS).toEqual(["age", "sex", "nationality", "citizenship"]);
    expect(BLOCKING_FLAGS).toEqual(["age", "sex", "nationality"]);
    expect(isBlocked(["citizenship"])).toBe(false);
    expect(isBlocked(["citizenship", "age"])).toBe(true);
    expect(isBlocked([])).toBe(false);
  });
});
