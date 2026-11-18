import { expect, test } from "@playwright/test";
import { authErrorText } from "../src/lib/auth-errors";

// Новый пароль — не короче 8 символов: форма не уходит в Supabase с паролем короче.
test("регистрация не принимает пароль короче 8 символов", async ({ page }) => {
  let signUpCalled = false;
  await page.route("**/auth/v1/signup**", route => {
    signUpCalled = true;
    return route.abort();
  });
  await page.goto("/register/form?role=candidate");
  await page.getByLabel("Email").fill("short-password@example.com");
  const password = page.getByLabel("Пароль", { exact: true });
  await page.getByRole("checkbox").check();
  await expect(page.getByText("Минимум 8 символов")).toBeVisible();

  await password.fill("1234567");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  expect(await password.evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true);
  expect(signUpCalled).toBe(false);

  await password.fill("12345678");
  expect(await password.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(true);
});

test("ошибка Supabase о коротком пароле называет 8 символов", () => {
  expect(authErrorText("Password should be at least 8 characters.")).toBe(
    "Пароль слишком простой: нужно не меньше 8 символов.",
  );
});
