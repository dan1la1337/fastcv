import { expect, test } from "@playwright/test";

// ИИ-вердикт по отклику в кабинете работодателя. ИИ подменён — проверяем кабинет, а не модель.
const employer = { email: process.env.E2E_EMPLOYER_EMAIL, password: process.env.E2E_EMPLOYER_PASSWORD };

test("работодатель получает ИИ-вердикт по отклику", async ({ page, isMobile }) => {
  test.skip(!employer.email || !employer.password, "нет секретов E2E_*");
  test.skip(isMobile, "достаточно desktop");
  await page.route("**/api/screen-application", route => route.fulfill({ json: { screening: {
    fit: "strong", headline: "Закрывает стек вакансии, есть продакшен-опыт", pros: ["Django в продакшене"],
    cons: ["Нет опыта с Kafka"], ask: "Как вы масштабировали Celery?",
  } } }));
  await page.goto(`/login?next=${encodeURIComponent("/employer")}`);
  await page.locator('input[type="email"]').fill(employer.email!);
  await page.locator('input[type="password"]').fill(employer.password!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/employer/, { timeout: 15_000 });

  const button = page.getByRole("button", { name: "ИИ-вердикт по отклику" }).first();
  const existing = page.getByLabel("ИИ-вердикт").first();
  await expect(button.or(existing)).toBeVisible({ timeout: 15_000 });
  if (await button.isVisible()) {
    await button.click();
    // Кнопка заменяется вердиктом — ищем его по тексту подменённого ответа
    const verdict = page.getByLabel("ИИ-вердикт").filter({ hasText: "Как вы масштабировали Celery?" });
    await expect(verdict).toBeVisible();
    await expect(verdict).toContainText("Сильный кандидат");
  }
  await page.getByRole("button", { name: "По вердикту ИИ" }).click();
  await expect(page.getByLabel("ИИ-вердикт").first()).toBeVisible();
});
