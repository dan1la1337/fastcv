import { expect, test } from "@playwright/test";

test("несуществующая страница — 404 с выходом в ленту", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Такой страницы нет")).toBeVisible();
  await page.getByRole("link", { name: "К вакансиям" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("несуществующая вакансия — 404", async ({ page }) => {
  const response = await page.goto("/vacancy/00000000-0000-0000-0000-000000000000");
  expect(response?.status()).toBe(404);
});

for (const path of ["/profile", "/applications", "/employer", "/welcome", "/admin"]) {
  test(`${path} без входа ведёт на вход и запоминает, куда шли`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}$`));
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
  });
}

test("вход с неверным паролем показывает ошибку по-русски", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("nobody@example.com");
  await page.locator('input[type="password"]').fill("wrong-password-123");
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText("Неверная почта или пароль.")).toBeVisible();
});

test("ссылка из письма с ошибкой ведёт на вход с понятным текстом", async ({ page }) => {
  await page.goto("/auth/callback?error_description=Email+link+is+invalid+or+has+expired");
  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(page.getByText(/Ссылка недействительна или устарела/)).toBeVisible();
});

test("заголовки безопасности на месте", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("страница направления отдаёт список вакансий в HTML", async ({ page, request }) => {
  const html = await (await request.get("/jobs/qa")).text();
  expect(html).toContain("Вакансии: QA и тестирование");
  await page.goto("/jobs/qa");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Вакансии: QA и тестирование");
  await page.getByRole("link", { name: "Frontend", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\/frontend$/);
});

test("каталог направлений ведёт на страницу направления", async ({ page }) => {
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Вакансии по направлениям");
  await page.locator('a[href="/jobs/qa"]').click();
  await expect(page).toHaveURL(/\/jobs\/qa$/);
});

test("неизвестное направление — 404", async ({ request }) => {
  expect((await request.get("/jobs/astronaut")).status()).toBe(404);
});

test("название компании ведёт на её страницу", async ({ page }) => {
  await page.goto("/");
  const company = page.locator('section a[href^="/company/"]').first();
  const name = (await company.textContent())!.trim();
  await company.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.locator('a[href^="/vacancy/"]').first()).toBeVisible();
});

test("карта сайта содержит направления и компании", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("/jobs/backend");
  expect(xml).toMatch(/\/company\//);
});

test("разметка JobPosting выводится только полной", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page.locator('a[href^="/vacancy/"]').evaluateAll(els =>
    [...new Set(els.map(a => a.getAttribute("href")!))].slice(0, 8),
  );
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    const html = await (await request.get(href)).text();
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!match) continue;
    const data = JSON.parse(match[1]);
    expect(data.hiringOrganization?.name, href).toBeTruthy();
    expect(data.jobLocation?.address?.addressLocality, href).toBeTruthy();
  }
});

test("юридические страницы открываются, ссылки на них есть в подвале", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Политика обработки данных" }).click();
  await expect(page.getByRole("heading", { name: "Политика обработки персональных данных" })).toBeVisible();
  await expect(page.getByText("Лобанов Данила Ильич")).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Пользовательское соглашение" })).toBeVisible();
});

test("регистрация недоступна без согласия с соглашением и политикой", async ({ page }) => {
  await page.goto("/register/form?role=candidate");
  const submit = page.getByRole("button", { name: "Зарегистрироваться" });
  await expect(submit).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(submit).toBeEnabled();
});

test("сброс пароля: ссылка со входа, форма запроса, без ссылки из письма — подсказка", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Забыли пароль?" }).click();
  await expect(page.getByRole("heading", { name: "Сброс пароля" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Отправить ссылку" })).toBeVisible();
  await page.goto("/reset-password/new");
  await expect(page.getByText("Ссылка устарела или уже использована")).toBeVisible();
});
