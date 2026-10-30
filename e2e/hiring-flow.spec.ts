import { expect, test, type Browser, type Page } from "@playwright/test";

// Сквозной сценарий найма на staging: работодатель публикует вакансию с вопросом блица →
// кандидат откликается через Smart Apply → работодатель видит ответ и приглашает →
// кандидат видит приглашение и оценивает собеседование. В конце вакансия закрывается.
// Аккаунты — те же, что в auth.spec.ts (секреты E2E_*); без них сценарий пропускается.
const candidate = { email: process.env.E2E_CANDIDATE_EMAIL, password: process.env.E2E_CANDIDATE_PASSWORD };
const employer = { email: process.env.E2E_EMPLOYER_EMAIL, password: process.env.E2E_EMPLOYER_PASSWORD };

// Шаги зависят друг от друга и меняют данные — по очереди и только на десктопе
test.describe.configure({ mode: "serial" });

async function logIn(page: Page, account: { email?: string; password?: string }, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator('input[type="email"]').fill(account.email!);
  await page.locator('input[type="password"]').fill(account.password!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

async function asUser(browser: Browser, account: { email?: string; password?: string }, next: string) {
  // Отдельный контекст на каждого пользователя — сессии не смешиваются
  const context = await browser.newContext();
  const page = await context.newPage();
  await logIn(page, account, next);
  return { page, close: () => context.close() };
}

const title = `E2E Python-разработчик ${Date.now()}`;
const question = "Сколько лет вы пишете на Python?";
const answer = "Четыре года, из них два — Django в продакшене.";
let vacancyId = "";
/** Отклик ушёл: при исчерпанном дневном лимите кандидата дальнейшие шаги не имеют смысла */
let applied = false;

test.describe("найм от вакансии до оценки собеседования", () => {
  test.skip(!candidate.email || !candidate.password || !employer.email || !employer.password, "нет секретов E2E_*");
  test.skip(({ isMobile }) => isMobile, "меняет данные: только desktop");

  test("работодатель публикует вакансию с вопросом блица", async ({ browser }) => {
    const { page, close } = await asUser(browser, employer, "/employer");
    await page.getByRole("button", { name: "Новая вакансия" }).first().click();
    await page.getByPlaceholder("Например: Senior Java Developer").fill(title);
    await page.getByPlaceholder("Python, Django, PostgreSQL").fill("Python, Django, PostgreSQL");
    await page.getByLabel("Вопрос 1").fill(question);
    await page.getByPlaceholder("Опишите стек, проект и задачи кандидата...")
      .fill("Тестовая вакансия сквозных тестов: бэкенд на Django, PostgreSQL, код-ревью. Закрывается автоматически.");
    await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
    await expect(page.getByText("Вакансия опубликована.")).toBeVisible();

    const card = page.locator("div.glass").filter({ has: page.getByRole("heading", { name: title }) });
    const href = await card.getByRole("link", { name: "Открыть страницу вакансии" }).getAttribute("href");
    vacancyId = href!.split("/").pop()!;
    expect(vacancyId).toMatch(/^[0-9a-f-]{36}$/);
    await close();
  });

  test("кандидат откликается с письмом и ответом на вопрос", async ({ browser }) => {
    test.skip(!vacancyId, "вакансия не создана");
    const { page, close } = await asUser(browser, candidate, `/vacancy/${vacancyId}`);
    // Письмо без ИИ: тест проверяет путь отклика, а не модель, и не тратит лимит генераций
    await page.route("**/api/cover-letter", route =>
      route.fulfill({ json: { text: "Здравствуйте! Пишу на Python четыре года и хочу в вашу команду.", source: "ai" } }));

    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("button", { name: "Написать письмо" }).click();
    await expect(page.locator(`#letter-${vacancyId}`)).toHaveValue(/четыре года/, { timeout: 15_000 });

    // Без ответа на вопрос отклик не уходит
    await page.getByRole("button", { name: "Откликнуться с письмом" }).click();
    await expect(page.getByText("Ответьте на вопросы работодателя")).toBeVisible();

    await page.getByLabel(question).fill(answer);
    await page.getByRole("button", { name: "Откликнуться с письмом" }).click();
    const limit = page.getByText(/лимит FastCV против рассылок/);
    // Отклик на вакансию работодателя открывает чат: первым сообщением — письмо и ответ
    const sent = page.getByRole("heading", { name: "Сообщения" });
    await expect(sent.or(limit)).toBeVisible({ timeout: 15_000 });
    // Тесты гоняются на каждый PR: при 15 откликах за сутки база законно отказывает
    test.skip(await limit.isVisible(), "у тестового кандидата исчерпан дневной лимит откликов");
    applied = true;
    const log = page.getByRole("log");
    await expect(log).toContainText("Ваш отклик на вакансию");
    await expect(log).toContainText("четыре года");
    await expect(log).toContainText(answer);
    await page.goto("/applications");
    await expect(page.locator("div.glass").filter({ hasText: title })).toContainText("Ждёт ответа работодателя");
    await close();
  });

  test("работодатель пишет кандидату в чат, кандидат отвечает", async ({ browser }) => {
    test.skip(!applied, "отклик не отправлен");
    const hr = await asUser(browser, employer, "/employer");
    await hr.page.getByRole("button", { name: "Сначала новые" }).click();
    await hr.page.locator("div.glass").filter({ hasText: title }).first().getByRole("link", { name: "Написать" }).click();
    await expect(hr.page).toHaveURL(/\/messages\?c=/);
    await expect(hr.page.getByRole("log")).toContainText(answer);
    const box = hr.page.getByLabel("Сообщение", { exact: true });
    await box.fill("Добрый день! Удобно созвониться завтра в 15:00?");
    await box.press("Enter");
    await expect(hr.page.getByRole("log")).toContainText("созвониться завтра");
    await expect(box).toHaveValue("");

    // Кандидат видит непрочитанное в списке и отвечает
    const cand = await asUser(browser, candidate, "/messages");
    const item = cand.page.getByRole("list", { name: "Диалоги" }).getByRole("button").filter({ hasText: title });
    await expect(item).toContainText("созвониться завтра");
    await item.click();
    await expect(cand.page.getByRole("log")).toContainText("Удобно созвониться");
    await cand.page.getByLabel("Сообщение", { exact: true }).fill("Да, удобно. Жду звонка.");
    await cand.page.getByRole("button", { name: "Отправить" }).click();
    await expect(cand.page.getByRole("log")).toContainText("Жду звонка");

    // Ответ приходит работодателю без перезагрузки (опрос раз в несколько секунд)
    await expect(hr.page.getByRole("log")).toContainText("Жду звонка", { timeout: 15_000 });
    await cand.close();
    await hr.close();
  });

  test("работодатель видит ответ на вопрос и приглашает", async ({ browser }) => {
    test.skip(!applied, "отклик не отправлен");
    const { page, close } = await asUser(browser, employer, "/employer");
    await page.getByRole("button", { name: "Сначала новые" }).click();
    const card = page.locator("div.glass").filter({ hasText: title }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(question)).toBeVisible();
    await expect(card.getByText(answer)).toBeVisible();

    await card.getByRole("button", { name: "Пригласить" }).click();
    await card.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByText(/Приглашение отправлено/)).toBeVisible();
    await expect(card).toContainText("Собеседование назначено");
    // Приглашение приходит и в чат
    await card.getByRole("link", { name: "Написать" }).click();
    await expect(page.getByRole("log")).toContainText("Приглашение на собеседование");
    await close();
  });

  test("кандидат видит приглашение и оценивает собеседование", async ({ browser }) => {
    test.skip(!applied, "отклик не отправлен");
    const { page, close } = await asUser(browser, candidate, "/applications");
    const card = page.locator("div.glass").filter({ hasText: title }).first();
    await expect(card).toContainText("Приглашение на собеседование");
    await expect(card).toContainText("приглашаем на собеседование");

    await card.getByRole("radio", { name: "4 из 5" }).click();
    await expect(card.getByRole("radio", { name: "4 из 5" })).toHaveAttribute("aria-checked", "true");
    // Оценка сохранена в базе, а не только на экране
    await page.reload();
    const reloaded = page.locator("div.glass").filter({ hasText: title }).first();
    await expect(reloaded.getByText("Ваша оценка собеседования")).toBeVisible();
    await expect(reloaded.getByRole("radio", { name: "4 из 5" })).toHaveAttribute("aria-checked", "true");
    await close();
  });

  test("кандидат оставляет отзыв о найме, работодатель отвечает", async ({ browser }) => {
    test.skip(!applied, "отклик не отправлен");
    const cand = await asUser(browser, candidate, "/applications");
    const card = cand.page.locator("div.glass").filter({ hasText: title }).first();
    await card.getByRole("button", { name: "Оставить отзыв" }).click();
    await card.getByRole("radiogroup", { name: "Оценка процесса найма" }).getByRole("radio", { name: "5 из 5" }).click();
    await card.getByLabel("Что понравилось").fill("Ответили за день, понятные этапы.");
    await card.getByRole("button", { name: "Опубликовать" }).click();
    await expect(card.getByRole("button", { name: "Изменить отзыв" })).toBeVisible();
    await cand.close();

    const hr = await asUser(browser, employer, "/employer");
    await hr.page.getByRole("tab", { name: "Отзывы" }).click();
    const review = hr.page.locator("div.glass").filter({ hasText: title }).filter({ hasText: "Ответили за день" }).first();
    await review.getByRole("button", { name: "Ответить публично" }).click();
    await review.getByLabel("Публичный ответ компании").fill("Спасибо за отзыв!");
    await review.getByRole("button", { name: "Опубликовать ответ" }).click();
    await expect(review).toContainText("Ваш ответ");
    await hr.close();
  });

  test.afterAll(async ({ browser }, info) => {
    if (!vacancyId || info.project.name !== "desktop") return;
    // Закрываем тестовую вакансию, чтобы она не висела в ленте staging
    const { page, close } = await asUser(browser, employer, "/employer");
    await page.getByRole("tab", { name: /Вакансии/ }).click();
    const card = page.locator("div.glass").filter({ has: page.getByRole("heading", { name: title }) });
    await card.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(card.getByText("закрыта")).toBeVisible();
    await close();
  });
});
