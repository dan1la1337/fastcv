// Только для серверного кода: fetch для запросов к ИИ (src/lib/ai-providers.ts) и к Telegram Bot API.
// С сервера в РФ Google отвечает отказом по региону, а Telegram заблокирован, поэтому там запросы идут через
// исходящий прокси из AI_HTTPS_PROXY (например, http://user:pass@host:3128).
// Переменная не задана (Vercel, локально) — обычный fetch, undici не загружается.

type ProxyFetch = (url: string, init: RequestInit) => Promise<Response>;

let proxied: { url: string; fetch: Promise<ProxyFetch> } | null = null;

function proxyFetch(proxyUrl: string): Promise<ProxyFetch> {
  if (proxied?.url !== proxyUrl) {
    proxied = {
      url: proxyUrl,
      fetch: import("undici").then(({ fetch, ProxyAgent }) => {
        const dispatcher = new ProxyAgent(proxyUrl);
        // fetch из того же пакета: во встроенном fetch Node своя версия undici
        return (url, init) => fetch(url, { ...init, dispatcher } as Parameters<typeof fetch>[1]) as unknown as Promise<Response>;
      }),
    };
  }
  return proxied.fetch;
}

export async function aiFetch(url: string, init: RequestInit): Promise<Response> {
  const proxyUrl = process.env.AI_HTTPS_PROXY?.trim();
  if (!proxyUrl) return fetch(url, init);
  return (await proxyFetch(proxyUrl))(url, init);
}
