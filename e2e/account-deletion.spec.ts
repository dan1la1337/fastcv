import { expect, test, type Page } from "@playwright/test";

// Удаление аккаунта: файлы резюме удаляются только после успешного delete_my_account().
// Запросы к RPC и хранилищу перехвачены — настоящий тестовый аккаунт не удаляется.
const candidate = { email: process.env.E2E_CANDIDATE_EMAIL, password: process.env.E2E_CANDIDATE_PASSWORD };

async function logIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator('input[type="email"]').fill(candidate.email!);
  await page.locator('input[type="password"]').fill(candidate.password!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

test.skip(!candidate.email || !candidate.password, "нет секретов E2E_CANDIDATE_*");

test("при ошибке удаления аккаунта резюме в хранилище не трогается", async ({ page }) => {
  const storage: string[] = [];
  await page.route("**/rest/v1/rpc/delete_my_account*", route =>
    route.fulfill({ status: 500, json: { code: "XX000", message: "test failure" } }));
  await page.route("**/storage/v1/object/list/resumes*", route => {
    storage.push("list");
    return route.fulfill({ json: [{ name: "resume.pdf", id: "00000000-0000-0000-0000-000000000000" }] });
  });
  await page.route("**/storage/v1/object/resumes*", route => {
    if (route.request().method() !== "DELETE") return route.continue();
    storage.push("remove");
    return route.fulfill({ json: [] });
  });

  await logIn(page, "/profile");
  await page.getByRole("button", { name: "Удалить аккаунт" }).click();
  await page.getByLabel(/Чтобы подтвердить/).fill("удалить");
  await page.getByRole("button", { name: "Удалить навсегда" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Не получилось удалить аккаунт" })).toBeVisible();
  expect(storage).not.toContain("remove");
  await expect(page).toHaveURL(/\/profile/);
});
