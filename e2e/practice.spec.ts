import { expect, test } from "@playwright/test";

// Тренажёр собеседования. ИИ подменён: тест проверяет страницу и путь кандидата,
// а не модель, и не тратит лимит генераций.
const candidate = { email: process.env.E2E_CANDIDATE_EMAIL, password: process.env.E2E_CANDIDATE_PASSWORD };

test("гостя тренажёр отправляет на вход", async ({ page }) => {
  await page.goto("/practice/00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/login\?next=%2Fpractice/);
});

test("кандидат проходит тренировку по вакансии", async ({ page }) => {
  test.skip(!candidate.email || !candidate.password, "нет секретов E2E_*");
  await page.goto("/");
  const href = await page.locator('a[href^="/vacancy/"]').first().getAttribute("href");
  const vacancyId = href!.split("/").pop()!.split(/[?#]/)[0];

  await page.goto(`/login?next=${encodeURIComponent(`/vacancy/${vacancyId}`)}`);
  await page.locator('input[type="email"]').fill(candidate.email!);
  await page.locator('input[type="password"]').fill(candidate.password!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(new RegExp(`/vacancy/${vacancyId}`), { timeout: 15_000 });

  await page.route("**/api/interview-practice", async route => {
    const body = route.request().postDataJSON();
    if (body.action === "questions") {
      return route.fulfill({ json: { source: "ai", questions: [
        { q: "Чем отличается процесс от потока?", kind: "tech", hint: "Память, переключение, примеры." },
        { q: "Расскажите о проекте, которым гордитесь.", kind: "behavior" },
      ] } });
    }
    return route.fulfill({ json: { grade: {
      score: 7, verdict: "Хорошая основа, не хватает примеров.", good: ["Верно про память"], improve: ["Добавьте пример из практики"],
      better: "Процесс — изолированное адресное пространство…",
    } } });
  });

  await page.getByRole("link", { name: /Тренажёр собеседования/ }).click();
  await expect(page).toHaveURL(new RegExp(`/practice/${vacancyId}`));
  await page.getByRole("button", { name: "Начать тренировку" }).click();

  await expect(page.getByRole("heading", { name: "Чем отличается процесс от потока?" })).toBeVisible();
  await page.getByRole("button", { name: "Подсказка" }).click();
  await expect(page.getByText("Память, переключение, примеры.")).toBeVisible();
  await page.getByLabel("Ваш ответ").fill("У процессов своя память, потоки делят память процесса.");
  await page.getByRole("button", { name: "Проверить ответ" }).click();
  const review = page.getByLabel("Разбор ответа");
  await expect(review).toContainText("7/10");
  await expect(review).toContainText("Добавьте пример из практики");
  await review.getByRole("button", { name: "Следующий вопрос" }).click();

  await expect(page.getByRole("heading", { name: "Расскажите о проекте, которым гордитесь." })).toBeVisible();
  await page.getByRole("button", { name: "Пропустить" }).click();
  const result = page.getByLabel("Итоги тренировки");
  await expect(result).toContainText("Средний балл: 7 из 10");
  await expect(result).toContainText("пропущен");
});
