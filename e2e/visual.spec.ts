import { expect, test, type Page } from "@playwright/test";

/**
 * Скриншот-тесты ключевых экранов: правка стилей не должна незаметно ломать вёрстку.
 * Только страницы, которые не зависят от данных; живые числа закрыты маской.
 * Эталоны лежат в e2e/visual.spec.ts-snapshots и снимаются в CI (шрифты Linux):
 * Actions → Visual baselines → Run workflow на своей ветке, когда дизайн меняется намеренно.
 */
const PAGES: [string, string][] = [
  ["login", "/login"],
  ["register", "/register"],
  ["register-form", "/register/form?role=candidate"],
  ["reset-password", "/reset-password"],
  ["not-found", "/no-such-page"],
];

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
}

for (const [name, path] of PAGES) {
  test(`вид: ${name}`, async ({ page }) => {
    await page.goto(path);
    await settle(page);
    await expect(page).toHaveScreenshot(`${name}.png`, { animations: "disabled", maxDiffPixelRatio: 0.02 });
  });
}

test("вид: первый экран главной", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  // Числа счётчика вакансий меняются каждый запуск: и в блоке, и в шапке
  const live = page.locator("[data-live-stats]");
  const headerCount = page.getByRole("banner").locator(".tabular-nums");
  await expect(page).toHaveScreenshot("home-hero.png", {
    animations: "disabled", maxDiffPixelRatio: 0.02, mask: [live, headerCount],
  });
});
