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

  test("меню аккаунта в ленте: разделы, клавиатура, выход", async ({ page }) => {
    await logIn(page, candidate, "/");
    const open = page.getByRole("button", { name: /^Меню профиля/ });
    await open.click();
    const menu = page.getByRole("menu", { name: "Меню профиля" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Профиль", "Мои отклики", /^Сообщения/, "Выйти"]);
    // Esc закрывает меню и возвращает фокус на кнопку
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(open).toBeFocused();

    await open.click();
    await menu.getByRole("menuitem", { name: "Профиль" }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(menu).toBeHidden();

    // Выход завершает все сессии аккаунта, а параллельные тесты входят им же: сервер не трогаем
    await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204 }));
    await page.goto("/");
    await open.click();
    await menu.getByRole("menuitem", { name: "Выйти" }).click();
    await expect(page.getByRole("banner").getByRole("link", { name: /^Войти/ })).toBeVisible();
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login/);
  });

  test("шапка кабинета и ленты: логотип и меню, разделы только в меню", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "верхняя панель только на десктопе");
    await logIn(page, candidate, "/profile");
    const bar = page.getByRole("banner");
    await expect(bar.getByRole("button", { name: /^Меню профиля/ })).toBeVisible();
    await expect(bar.getByRole("link")).toHaveCount(1);
    await bar.getByRole("link", { name: "FastCV — на главную" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(bar.getByRole("button", { name: /^Меню профиля/ })).toBeVisible();
    await expect(bar.getByRole("link")).toHaveCount(1);
  });

  test("переход из кабинета в ленту не показывает вошедшему кнопку входа и приветствие", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "логотип в кабинете на десктопе стоит в общей панели");
    await logIn(page, candidate, "/profile");
    // Каждый кадр смотрим, видел ли человек экран гостя: состояние держится доли секунды
    await page.evaluate(() => {
      const state = window as unknown as { guestSeen: boolean };
      state.guestSeen = false;
      const check = () => {
        const login = document.querySelector<HTMLElement>('header a[href="/login"]');
        const hero = document.querySelector<HTMLElement>(".guest-only");
        if (login?.offsetParent || hero?.offsetParent) state.guestSeen = true;
        requestAnimationFrame(check);
      };
      check();
    });
    await page.getByRole("banner").getByRole("link", { name: "FastCV — на главную" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("#feed section h2").first()).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: /^Меню профиля/ })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { guestSeen: boolean }).guestSeen)).toBe(false);
  });

  test("в профиле выход только в меню аккаунта, на обоих устройствах", async ({ page }) => {
    await logIn(page, candidate, "/profile");
    await expect(page.getByRole("button", { name: "Выйти" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Меню профиля/ }).click();
    await expect(page.getByRole("menuitem", { name: "Выйти" })).toBeVisible();
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
