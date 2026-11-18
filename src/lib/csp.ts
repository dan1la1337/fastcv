// Content Security Policy с nonce: заголовок собирает src/proxy.ts на каждый запрос.

/**
 * Свой сервер Supabase (перенос в РФ, infra/ru-migration): его адрес тоже разрешаем.
 * Облачный *.supabase.co разрешён и так; браузер в основном ходит через /sb (свой домен).
 */
function supabaseOrigin(): string {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return u.hostname.endsWith(".supabase.co") ? "" : ` ${u.origin} wss://${u.host}`;
  } catch {
    return "";
  }
}

/**
 * Политика для одного ответа. Встроенные скрипты выполняются только с этим nonce:
 * Next.js сам ставит его на свои скрипты, свои (признак входа, JSON-LD) берут его из x-nonce.
 * Без 'strict-dynamic': так продолжают работать источники из списка (vercel.live на превью).
 * Стили остаются с 'unsafe-inline': атрибуты style={…} nonce не поддерживают.
 */
export function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  // На превью Vercel показывает свою панель комментариев (vercel.live) — разрешаем её только там
  const isPreview = process.env.VERCEL_ENV === "preview";
  const vercelLive = isPreview ? " https://vercel.live" : "";
  const vercelLiveWs = isPreview ? " wss://ws-us3.pusher.com https://*.pusher.com" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}${vercelLive}`,
    "style-src 'self' 'unsafe-inline'",
    // Supabase: API, авторизация, хранилище резюме (fetch) и realtime (wss)
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${supabaseOrigin()}${vercelLive}${vercelLiveWs}`,
    `img-src 'self' blob: data:${vercelLive} https://vercel.com`,
    "font-src 'self' data:",
    `frame-src 'self'${vercelLive}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Случайный nonce: 128 бит в base64. */
export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}
