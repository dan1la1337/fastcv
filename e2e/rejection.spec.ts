import { expect, test } from "@playwright/test";

// Разбор отказа. ИИ подменён — проверяем страницу и путь кандидата. Нужен отклик со статусом
// «Отказ» у тестового кандидата на staging; если его нет — тест пропускается.
const candidate = { email: process.env.E2E_CANDIDATE_EMAIL, password: process.env.E2E_CANDIDATE_PASSWORD };

test("кандидат открывает ИИ-разбор отказа", async ({ page, isMobile }) => {
  test.skip(!candidate.email || !candidate.password, "нет секретов E2E_*");
  test.skip(isMobile, "достаточно desktop");
  await page.route("**/api/rejection-analysis", route => route.fulfill({ json: { analysis: {
    summary: "Скорее всего, не хватило опыта с Kafka.", reasons: ["Нет коммерческого опыта с Kafka"],
    strengths: ["Сильный Django"], gaps: ["Kafka"], letter: "", next: ["Сделайте пет-проект с Kafka"], match: 40,
  } } }));
  await page.goto(`/login?next=${encodeURIComponent("/applications")}`);
  await page.locator('input[type="email"]').fill(candidate.email!);
  await page.locator('input[type="password"]').fill(candidate.password!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/applications/, { timeout: 15_000 });

  await expect(page.locator("div.glass").first()).toBeVisible();
  const button = page.getByRole("button", { name: /Почему отказали\?|Разбор отказа/ }).first();
  test.skip(!(await button.isVisible()), "у тестового кандидата нет отказов");
  await button.click();
  const panel = page.getByLabel("Разбор отказа");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Вероятные причины");
  await expect(panel).toContainText("Что сделать дальше");
});
