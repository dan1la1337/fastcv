// Постраничный вывод каталога (страницы направления и компании): ?page=N, первая — без параметра.

/** Вакансий на странице направления и компании. */
export const CATALOG_PAGE_SIZE = 60;

/** ?page из адреса: целое ≥ 1; нет параметра — первая страница, мусор — null (страница 404). */
export function parsePage(raw: string | string[] | undefined): number | null {
  if (raw === undefined) return 1;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!/^[1-9]\d{0,4}$/.test(value ?? "")) return null;
  return Number(value);
}

/** Адрес страницы: первая — без ?page, чтобы у неё был один канонический адрес. */
export function pageHref(base: string, page: number): string {
  return page <= 1 ? base : `${base}?page=${page}`;
}

/** Всего вакансий и страниц. Счётчик направлений в базе обновляется с запаздыванием:
 *  не меньше того, что видно на этой странице, и страниц не меньше, чем есть на деле. */
export function pageCount(page: number, shown: number, hasNext: boolean, total: number | null) {
  const all = Math.max(total ?? 0, (page - 1) * CATALOG_PAGE_SIZE + shown);
  const pages = Math.max(Math.ceil(all / CATALOG_PAGE_SIZE), hasNext ? page + 1 : page, 1);
  return { total: all, pages };
}
