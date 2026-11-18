// Адрес возврата после входа (?next=…): только страница нашего сайта.

/**
 * `next` → путь на том же сайте (`/vacancy/1?x=y#z`) или null.
 * Адрес разбирается так же, как его разберёт браузер: `//evil.com`, `/\evil.com`,
 * `https://evil.com` и варианты с табами и переносами уводят на чужой origin и отбрасываются.
 */
export function safeNext(next: string | null | undefined, origin: string): string | null {
  if (!next || !next.startsWith("/")) return null;
  try {
    const base = new URL(origin);
    const url = new URL(next, base);
    if (url.origin !== base.origin) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
