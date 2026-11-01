import { expect, test } from "@playwright/test";

// Кандидат с заполненным профилем попадает сразу в подборку «Для вас», и она собирается
// (раньше падала по таймауту базы). Тестовый кандидат staging — с направлениями и навыками.
const candidate = { email: process.env.E2E_CANDIDATE_EMAIL, password: process.env.E2E_CANDIDATE_PASSWORD };

test("подборка «Для вас» открывается по умолчанию и собирается", async ({ page }) => {
  test.skip(!candidate.email || !candidate.password, "нет секретов E2E_*");
  await page.goto("/login?next=%2F");
  await page.locator('input[type="email"]').fill(candidate.email!);
  await page.locator('input[type="password"]').fill(candidate.password!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  const tab = page.getByRole("tab", { name: "Для вас" });
  await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
  await expect(page.getByText("Вакансии отсортированы по совпадению")).toBeVisible();
  await expect(page.locator('a[href^="/vacancy/"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Не удалось собрать подборку")).toHaveCount(0);

  // «Все вакансии» — обычная лента
  await page.getByRole("tab", { name: "Все вакансии" }).click();
  await expect(page.getByRole("tab", { name: "Все вакансии" })).toHaveAttribute("aria-selected", "true");
});
