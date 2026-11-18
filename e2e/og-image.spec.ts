import { expect, test, type APIRequestContext } from "@playwright/test";

// Картинки для репостов в Telegram и VK: страница ссылается на og:image, и по ссылке отдаётся PNG
async function ogImage(request: APIRequestContext, path: string) {
  const html = await (await request.get(path)).text();
  const content = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  expect(content, `на ${path} нет og:image`).toBeTruthy();
  // metadataBase — рабочий домен; картинку берём с тестового сервера
  const url = new URL(content!.replace(/&amp;/g, "&"));
  const response = await request.get(url.pathname + url.search);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  const body = await response.body();
  expect(body.subarray(1, 4).toString()).toBe("PNG");
  expect(body.length).toBeGreaterThan(10_000);
}

for (const [kind, selector] of [["вакансии", 'a[href^="/vacancy/"]'], ["компании", 'section a[href^="/company/"]']]) {
  test(`картинка для репоста страницы ${kind}`, async ({ page, request }) => {
    // Первая картинка после запуска сервера рисуется дольше: загрузка шрифтов и движка отрисовки
    test.setTimeout(90_000);
    await page.goto("/");
    const href = await page.locator(selector).first().getAttribute("href");
    expect(href).toBeTruthy();
    await ogImage(request, href!);
  });
}
