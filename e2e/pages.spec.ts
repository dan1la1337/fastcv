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

for (const path of ["/profile", "/applications", "/employer"]) {
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
