import { expect, test } from "@playwright/test";

// CSP без 'unsafe-inline' для скриптов: встроенные скрипты выполняются только с nonce этого ответа.
function scriptSrc(csp: string | undefined): string {
  return (csp ?? "").split(";").map(s => s.trim()).find(s => s.startsWith("script-src")) ?? "";
}

test("CSP: nonce новый на каждый запрос, без 'unsafe-inline' для скриптов", async ({ request }) => {
  // Страница вакансии: там ещё JSON-LD
  const vacancy = (await (await request.get("/jobs/qa")).text()).match(/href="(\/vacancy\/[^"?#]+)"/)?.[1];
  expect(vacancy, "ссылка на вакансию в /jobs/qa").toBeTruthy();
  const nonces: string[] = [];
  for (const path of ["/", "/login", "/login", vacancy!]) {
    const response = await request.get(path);
    const src = scriptSrc(response.headers()["content-security-policy"]);
    expect(src).not.toContain("'unsafe-inline'");
    const nonce = src.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce, `nonce в CSP для ${path}`).toBeTruthy();
    nonces.push(nonce!);
    // Каждый <script> в HTML несёт nonce этого ответа
    const html = await response.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag, path).toContain(`nonce="${nonce}"`);
  }
  expect(new Set(nonces).size).toBe(nonces.length);
});

test("CSP: страница работает без нарушений, встроенный скрипт признака входа выполняется", async ({ page, context, baseURL }) => {
  const violations: string[] = [];
  page.on("console", msg => {
    if (/Content Security Policy/i.test(msg.text())) violations.push(msg.text());
  });
  // Кука вида sb-…-auth-token: скрипт в <head> ставит data-auth="1" ещё до отрисовки
  await context.addCookies([{ name: "sb-csp-test-auth-token", value: "x", url: baseURL! }]);
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-auth", "1");
  // Гидратация прошла: клиентская навигация по ссылке работает
  await page.getByRole("link", { name: "Забыли пароль?" }).click();
  await expect(page.getByRole("heading", { name: "Сброс пароля" })).toBeVisible();
  expect(violations).toEqual([]);
});
