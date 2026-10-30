import { expect, test, type Browser, type Page } from "@playwright/test";

// База резюме на staging: кандидат открывает резюме → работодатель находит его по поиску
// и пишет в чат → кандидат скрывает резюме. Аккаунты — секреты E2E_* (как в hiring-flow).
const candidate = { email: process.env.E2E_CANDIDATE_EMAIL, password: process.env.E2E_CANDIDATE_PASSWORD };
const employer = { email: process.env.E2E_EMPLOYER_EMAIL, password: process.env.E2E_EMPLOYER_PASSWORD };

test.describe.configure({ mode: "serial" });

async function logIn(page: Page, account: { email?: string; password?: string }, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator('input[type="email"]').fill(account.email!);
  await page.locator('input[type="password"]').fill(account.password!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

async function asUser(browser: Browser, account: { email?: string; password?: string }, next: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, account, next);
  return { page, close: () => context.close() };
}

const token = `e2e${Date.now()}`;
const headline = `Тестировщик ${token}`;
let chatUrl = "";

test.describe("база резюме", () => {
  test.skip(!candidate.email || !candidate.password || !employer.email || !employer.password, "нет секретов E2E_*");
  test.skip(({ isMobile }) => isMobile, "меняет данные: только desktop");

  test("кандидат открывает резюме работодателям", async ({ browser }) => {
    const { page, close } = await asUser(browser, candidate, "/profile");
    const section = page.getByRole("region", { name: "База резюме для работодателей" });
    await section.getByLabel("Желаемая должность").fill(headline);
    const open = section.getByRole("button", { name: "Открыть резюме работодателям" });
    if (await open.isVisible()) await open.click();
    else await section.getByRole("button", { name: "Сохранить должность" }).click();
    await expect(section.getByRole("button", { name: "Скрыть резюме" })).toBeVisible();
    await close();
  });

  test("работодатель находит кандидата и пишет ему", async ({ browser }) => {
    const { page, close } = await asUser(browser, employer, "/resumes");
    await expect(page.getByRole("heading", { name: "База резюме" })).toBeVisible();
    await page.getByLabel("Поиск").fill(token);
    const card = page.getByRole("listitem").filter({ hasText: headline });
    await expect(card).toHaveCount(1, { timeout: 10_000 });
    await card.getByRole("button", { name: /Сохранить|Сохранён/ }).click();
    await card.getByRole("button", { name: /Написать кандидату|Предложить вакансию/ }).click();
    const dialog = page.getByRole("dialog", { name: "Написать кандидату" });
    await dialog.getByLabel("Сообщение").fill(`Здравствуйте! Нашли ваше резюме (${token}).`);
    await dialog.getByRole("button", { name: "Отправить" }).click();
    await expect(page).toHaveURL(/\/messages\?c=/);
    await expect(page.getByRole("log")).toContainText(token);
    chatUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    // Сохранённые
    await page.goto("/resumes");
    await page.getByRole("tab", { name: "Сохранённые" }).click();
    await page.getByLabel("Поиск").fill(token);
    await expect(page.getByRole("listitem").filter({ hasText: headline })).toHaveCount(1);
    await close();
  });

  test("работодатель предлагает время, кандидат записывается и отменяет", async ({ browser }) => {
    test.skip(!chatUrl, "диалог не открыт");
    const hr = await asUser(browser, employer, chatUrl);
    await hr.page.getByRole("button", { name: "Предложить время собеседования" }).click();
    const form = hr.page.getByRole("group", { name: "Предложить время собеседования" });
    await form.getByLabel("Ссылка или адрес").fill("https://meet.example/e2e");
    await form.getByRole("button", { name: "Отправить варианты" }).click();
    await expect(hr.page.getByRole("log").getByText("Вы предложили время собеседования").last()).toBeVisible();

    const cand = await asUser(browser, candidate, chatUrl);
    const options = cand.page.getByRole("list", { name: "Варианты времени" }).last();
    await options.getByRole("button").first().click();
    const banner = cand.page.getByLabel("Назначенное собеседование");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("meet.example/e2e");
    await expect(cand.page.getByRole("log")).toContainText("Вы записались на собеседование");

    // Работодатель видит запись без перезагрузки
    await expect(hr.page.getByRole("log")).toContainText("Кандидат записался на собеседование", { timeout: 15_000 });
    await expect(hr.page.getByLabel("Назначенное собеседование")).toBeVisible({ timeout: 15_000 });

    // Отмена — чтобы на staging не копились записи и напоминания
    await banner.getByRole("button", { name: "Отменить", exact: true }).click();
    await banner.getByLabel("Причина отмены").fill("e2e");
    await banner.getByRole("button", { name: "Отменить встречу" }).click();
    await expect(cand.page.getByRole("log")).toContainText("Вы отменили собеседование");
    await expect(banner).toBeHidden();
    await cand.close();
    await hr.close();
  });

  test("кандидат видит сообщение и скрывает резюме", async ({ browser }) => {
    const { page, close } = await asUser(browser, candidate, "/messages");
    await expect(page.getByRole("list", { name: "Диалоги" })).toContainText(token);
    await page.goto("/profile");
    const section = page.getByRole("region", { name: "База резюме для работодателей" });
    await section.getByRole("button", { name: "Скрыть резюме" }).click();
    await expect(section.getByRole("button", { name: "Открыть резюме работодателям" })).toBeVisible();
    await close();
  });
});
