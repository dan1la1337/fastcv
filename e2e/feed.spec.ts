import { expect, test, type Page } from "@playwright/test";

/** Число в бейдже «N вакансий» в шапке (на телефоне бейдж скрыт, но текст в DOM есть). */
async function total(page: Page): Promise<number> {
  const text = await page.locator("header span", { hasText: /ваканси/ }).first().textContent();
  return Number(text?.match(/\d+/)?.[0] ?? NaN);
}

/** На телефоне фильтры свёрнуты — раскрываем. */
async function openFilters(page: Page) {
  const toggle = page.getByRole("button", { name: /Фильтры/ });
  if (await toggle.isVisible()) await toggle.click();
}

test("главная сразу отдаёт вакансии в HTML", async ({ request }) => {
  const html = await (await request.get("/")).text();
  expect(html.match(/href="\/vacancy\//g)?.length ?? 0).toBeGreaterThan(0);
});

test("лента показывает карточки и счётчик", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("section h2").first()).toBeVisible();
  expect(await total(page)).toBeGreaterThan(0);
});

test("фильтр по направлению сужает ленту и снимается повторным нажатием", async ({ page }) => {
  await page.goto("/");
  await openFilters(page);
  const all = await total(page);
  await page.getByRole("button", { name: "QA и тестирование", exact: true }).click();
  await expect.poll(() => total(page)).toBeLessThan(all);
  await expect(page.locator("section h2").first()).toBeVisible();
  await page.getByRole("button", { name: "QA и тестирование", exact: true }).click();
  await expect.poll(() => total(page)).toBe(all);
});

test("уровень и формат работы фильтруют вместе", async ({ page }) => {
  await page.goto("/");
  await openFilters(page);
  const all = await total(page);
  await page.getByRole("button", { name: "Senior", exact: true }).click();
  await expect.poll(() => total(page)).toBeLessThan(all);
  const senior = await total(page);
  await page.getByRole("button", { name: "Удалённо", exact: true }).click();
  await expect.poll(() => total(page)).toBeLessThanOrEqual(senior);
  // В карточках — только Senior
  for (const card of await page.locator("section h2").all()) {
    const meta = await card.locator("xpath=..").textContent();
    expect(meta).toContain("Senior");
  }
});

test("поиск понимает словоформы", async ({ page }) => {
  await page.goto("/");
  await openFilters(page);
  await page.getByPlaceholder("Java, Backend...").fill("разработчики");
  await expect.poll(() => total(page)).toBeGreaterThan(0);
  await page.getByPlaceholder("Java, Backend...").fill("zzzz-нет-такого");
  await expect(page.getByText("Ничего не нашлось")).toBeVisible();
});

test("карточка ведёт на страницу вакансии", async ({ page }) => {
  await page.goto("/");
  const link = page.locator('section h2 a[href^="/vacancy/"]').first();
  const title = (await link.textContent())!.trim();
  // Страница вакансии засчитывает просмотр (воронка в кабинете работодателя)
  const view = page.waitForResponse(r => r.url().includes("/rpc/register_vacancy_view"));
  await link.click();
  expect((await view).ok()).toBe(true);
  await expect(page).toHaveURL(/\/vacancy\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByRole("button", { name: /Откликнуться/ })).toBeVisible();
});

test("Smart Apply без входа предлагает войти", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Smart Apply/ }).first().click();
  await expect(page.getByRole("link", { name: "Войдите, чтобы откликнуться" })).toBeVisible();
});
