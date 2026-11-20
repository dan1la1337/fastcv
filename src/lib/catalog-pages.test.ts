import { describe, expect, it } from "vitest";
import { CATALOG_PAGE_SIZE, pageCount, pageHref, parsePage } from "@/lib/catalog-pages";

describe("страницы каталога", () => {
  it("?page: нет — первая, целое ≥ 1 — номер, остальное — 404", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["2", "5"])).toBe(2);
    for (const bad of ["0", "-1", "abc", "2.5", "", "01", "999999"]) expect(parsePage(bad)).toBeNull();
  });

  it("первая страница без ?page — один канонический адрес", () => {
    expect(pageHref("/jobs/product", 1)).toBe("/jobs/product");
    expect(pageHref("/jobs/product", 4)).toBe("/jobs/product?page=4");
  });

  it("всего и страниц — по счётчику, но не меньше видимого", () => {
    expect(CATALOG_PAGE_SIZE).toBe(60);
    expect(pageCount(1, 60, true, 952)).toEqual({ total: 952, pages: 16 });
    expect(pageCount(16, 52, false, 952)).toEqual({ total: 952, pages: 16 });
    // Счётчик отстал: на деле вакансий больше — страница не теряется
    expect(pageCount(16, 60, true, 892)).toEqual({ total: 960, pages: 17 });
    expect(pageCount(1, 0, false, null)).toEqual({ total: 0, pages: 1 });
  });
});
