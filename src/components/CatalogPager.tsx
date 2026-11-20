import Link from "next/link";
import { pageHref } from "@/lib/catalog-pages";

/** Переход между страницами каталога. Ссылки rel=prev/next React поднимает в <head>. */
export default function CatalogPager({ base, page, pages }: { base: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  const prev = page > 1 ? pageHref(base, page - 1) : null;
  const next = page < pages ? pageHref(base, page + 1) : null;
  const link = "lg text-sm px-4 py-2 rounded-lg text-neutral-200";
  return (
    <>
      {prev && <link rel="prev" href={prev} />}
      {next && <link rel="next" href={next} />}
      <nav aria-label="Страницы" className="flex items-center justify-between gap-3 pt-2">
        {prev ? <Link href={prev} rel="prev" className={link}>← Назад</Link> : <span />}
        <span className="text-sm text-neutral-400">Страница {page} из {pages}</span>
        {next ? <Link href={next} rel="next" className={link}>Дальше →</Link> : <span />}
      </nav>
    </>
  );
}
