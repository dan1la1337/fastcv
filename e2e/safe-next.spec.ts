import { expect, test } from "@playwright/test";
import { safeNext } from "../src/lib/safe-next";

// Адрес возврата после входа (?next=…) не уводит на чужой сайт. Проверка без браузера.
const origin = "https://fastcv.example";

test.describe("safeNext", () => {
  test("пропускает страницы нашего сайта", () => {
    expect(safeNext("/vacancy/42", origin)).toBe("/vacancy/42");
    expect(safeNext("/profile?tab=resume#top", origin)).toBe("/profile?tab=resume#top");
    expect(safeNext("/reset-password/new", origin)).toBe("/reset-password/new");
  });

  for (const next of [
    "//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http:evil.com",
    "javascript:alert(1)",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r\n/evil.com",
    " //evil.com",
    "evil.com",
    "",
  ]) {
    test(`отбрасывает ${JSON.stringify(next)}`, () => {
      expect(safeNext(next, origin)).toBeNull();
    });
  }

  test("отбрасывает пустое значение", () => {
    expect(safeNext(null, origin)).toBeNull();
    expect(safeNext(undefined, origin)).toBeNull();
  });

  test("закодированные варианты остаются путём на нашем сайте", () => {
    // URLSearchParams раскодирует %2F%2F и %5C до вызова; то, что осталось закодированным, — часть пути
    expect(safeNext(new URLSearchParams("next=%2F%2Fevil.com").get("next"), origin)).toBeNull();
    expect(safeNext(new URLSearchParams("next=%2F%5Cevil.com").get("next"), origin)).toBeNull();
    expect(safeNext("/%2F%2Fevil.com", origin)).toBe("/%2F%2Fevil.com");
    expect(safeNext("/%5Cevil.com", origin)).toBe("/%5Cevil.com");
  });
});
