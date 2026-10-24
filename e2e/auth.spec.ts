import { expect, test, type Page } from "@playwright/test";

// Сценарии со входом: тестовые аккаунты на staging. Почта и пароли — в секретах GitHub
// (E2E_CANDIDATE_*, E2E_EMPLOYER_*); без них тесты пропускаются, а не падают.
const candidate = { email: process.env.E2E_CANDIDATE_EMAIL, password: process.env.E2E_CANDIDATE_PASSWORD };
const employer = { email: process.env.E2E_EMPLOYER_EMAIL, password: process.env.E2E_EMPLOYER_PASSWORD };

async function logIn(page: Page, account: { email?: string; password?: string }, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.locator('input[type="email"]').fill(account.email!);
  await page.locator('input[type="password"]').fill(account.password!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

test.describe("кандидат", () => {
  test.skip(!candidate.email || !candidate.password, "нет секретов E2E_CANDIDATE_*");

  test("входит и попадает в ленту или онбординг", async ({ page }) => {
    await logIn(page, candidate);
    await expect(page).toHaveURL(/\/(welcome)?$/);
  });

  test("открывает личный кабинет и свои отклики", async ({ page }) => {
    await logIn(page, candidate, "/profile");
    await expect(page.getByRole("heading", { name: "Личный кабинет" })).toBeVisible();
    await page.goto("/applications");
    await expect(page.getByRole("heading", { name: "Мои отклики" })).toBeVisible();
  });

  test("добавляет вакансию в избранное и убирает обратно", async ({ page }, info) => {
    // Меняет данные аккаунта — только в одном проекте, чтобы прогоны не мешали друг другу
    test.skip(info.project.name !== "desktop", "изменяет данные: только desktop");
    await logIn(page, candidate, "/");
    await page.waitForLoadState("networkidle"); // отметки пользователя подгружаются после ленты
    // Одна и та же кнопка в обоих состояниях: следим за aria-pressed, а не за текстом
    const mark = page.locator("button[aria-pressed]").filter({ hasText: /В избранн/ }).first();
    // Начальное состояние может остаться от прерванного прогона — переключаем и возвращаем как было
    const before = await mark.getAttribute("aria-pressed");
    const after = before === "true" ? "false" : "true";
    await mark.click();
    await expect(mark).toHaveAttribute("aria-pressed", after);
    await mark.click();
    await expect(mark).toHaveAttribute("aria-pressed", before!);
  });
});

test.describe("работодатель", () => {
  test.skip(!employer.email || !employer.password, "нет секретов E2E_EMPLOYER_*");

  test("входит и попадает в кабинет работодателя", async ({ page }) => {
    await logIn(page, employer);
    await expect(page).toHaveURL(/\/employer$/);
    await expect(page.getByRole("heading", { name: "Кабинет работодателя" })).toBeVisible();
  });
});
