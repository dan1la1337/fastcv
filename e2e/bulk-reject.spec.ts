import { expect, test } from "@playwright/test";
import { rejectAll, rejectNotice, type RejectUpdate } from "../src/lib/bulk-reject";
import { isAccessDenied, loadErrorText } from "../src/lib/load-errors";

// Массовый отказ и тексты ошибок кабинетов: без браузера, только логика.
test.describe("массовый отказ", () => {
  test.skip(({ isMobile }) => isMobile, "логика без страницы");

  const groups = [
    { message: "A", ids: ["a1", "a2"] },
    { message: "B", ids: ["b1"] },
    { message: "C", ids: ["c1", "c2"] },
  ];

  test("ошибка в одной вакансии не останавливает остальные", async () => {
    const calls: string[] = [];
    const update: RejectUpdate = async (ids, message) => {
      calls.push(message);
      if (message === "B") return { updated: [], error: "network down" };
      if (message === "C") throw new Error("timeout");
      return { updated: ids, error: null };
    };
    const result = await rejectAll(groups, update);
    expect(calls).toEqual(["A", "B", "C"]);
    expect(result.done).toEqual({ a1: "A", a2: "A" });
    expect(result.failed).toEqual([{ ids: ["b1"], error: "network down" }, { ids: ["c1", "c2"], error: "timeout" }]);

    const notice = rejectNotice(result);
    expect(notice.kind).toBe("error");
    expect(notice.text).toContain("Отправлено отказов: 2 из 5");
    expect(notice.text).toContain("Не отправлено: 3 (network down; timeout)");
  });

  test("отклик, который база не обновила без ошибки, считается неотправленным", async () => {
    const result = await rejectAll([groups[0]], async () => ({ updated: ["a1"], error: null }));
    expect(result.done).toEqual({ a1: "A" });
    expect(result.failed).toEqual([{ ids: ["a2"], error: "отклик недоступен или уже изменён" }]);
  });

  test("все отправлены — зелёная плашка", async () => {
    const result = await rejectAll(groups, async ids => ({ updated: ids, error: null }));
    expect(result.failed).toEqual([]);
    expect(rejectNotice(result)).toEqual({ kind: "ok", text: "Отправлено отказов: 5. Кандидаты увидят ответ в «Моих откликах» и в чате." });
  });
});

test.describe("ошибки загрузки", () => {
  test.skip(({ isMobile }) => isMobile, "логика без страницы");

  test("ошибки перечислены, без ошибок — null", () => {
    expect(loadErrorText([["отклики", null], ["вакансии", null]])).toBeNull();
    expect(loadErrorText([["отклики", { message: "timeout" }], ["вакансии", null], ["совпадения", { message: "500" }]]))
      .toBe("Не удалось загрузить: отклики (timeout), совпадения (500). Обновите страницу.");
  });

  test("/admin: 404 только на отказ в доступе", () => {
    expect(isAccessDenied({ code: "42501" })).toBe(true);
    expect(isAccessDenied({ code: "PGRST301" })).toBe(false);
    expect(isAccessDenied({ code: "" })).toBe(false);
    expect(isAccessDenied(null)).toBe(false);
  });
});
