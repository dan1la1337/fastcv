// Разовая подготовка тестовых данных на staging. Запись здесь, а не в capture:
// capture только читает. Повторный запуск запрещён, пока существует data.json.
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { HERE, BASE_URL, accounts, loadEnv, login, startServer } from "./lib.mjs";

const DATA = resolve(HERE, "data.json");
if (existsSync(DATA)) throw new Error("data.json уже есть: данные созданы");

const COMPANY = "Северный Код";
const env = loadEnv();
const who = accounts(env);
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function session(account) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!res.ok) throw new Error(`вход: ${res.status}`);
  return res.json();
}

async function updateProfile(s, fields) {
  const res = await fetch(`${url}/rest/v1/profiles?id=eq.${s.user.id}`, {
    method: "PATCH",
    headers: { apikey: key, Authorization: `Bearer ${s.access_token}`, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(fields),
  });
  const rows = await res.json();
  if (!res.ok || rows.length !== 1) throw new Error(`профиль: ${res.status} ${JSON.stringify(rows).slice(0, 200)}`);
  return rows[0];
}

async function publish(page, v) {
  await page.goto(`${BASE_URL}/employer`);
  await page.getByRole("button", { name: "Новая вакансия" }).first().click();
  await page.getByPlaceholder("Например: Senior Java Developer").fill(v.title);
  await page.getByPlaceholder("150000", { exact: true }).fill(String(v.min));
  await page.getByPlaceholder("250000", { exact: true }).fill(String(v.max));
  await page.getByPlaceholder("Москва").fill("Москва");
  await page.getByPlaceholder("Python, Django, PostgreSQL").fill(v.stack);
  await page.getByLabel("Вопрос 1").fill(v.question);
  await page.getByPlaceholder("Опишите стек, проект и задачи кандидата...").fill(v.text);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Вакансия опубликована.")).toBeVisible();
  const card = page.locator("div.glass").filter({ has: page.getByRole("heading", { name: v.title }) });
  const href = await card.getByRole("link", { name: "Открыть страницу вакансии" }).getAttribute("href");
  return href.split("/").pop();
}

async function apply(page, id, answerLabel, answer) {
  await page.goto(`${BASE_URL}/vacancy/${id}`);
  await page.getByRole("button", { name: "Написать письмо" }).click();
  await expect(page.locator(`#letter-${id}`)).toHaveValue(/четыре года/, { timeout: 15_000 });
  await page.getByLabel(answerLabel).fill(answer);
  await page.getByRole("button", { name: "Откликнуться с письмом" }).click();
  await expect(page.getByRole("heading", { name: "Сообщения" })).toBeVisible({ timeout: 15_000 });
}

const VACANCIES = {
  invited: { title: "Python-разработчик (Django)", min: 220000, max: 320000, stack: "Python, Django, PostgreSQL", question: "Сколько лет вы пишете на Python?",
    text: "Развиваем платформу для логистики: бэкенд на Django, PostgreSQL, очереди на Celery. Команда из шести человек, код-ревью, релизы каждую неделю. Нужен опыт от трёх лет и работа с нагруженными запросами." },
  pending: { title: "Backend-разработчик (Python, FastAPI)", min: 250000, max: 350000, stack: "Python, FastAPI, Redis", question: "С какими очередями вы работали?",
    text: "Сервис расчёта маршрутов: FastAPI, Redis, PostgreSQL. Отвечаете за API и производительность, участвуете в проектировании. Нужен опыт от трёх лет и понимание асинхронного Python." },
  open: { title: "Senior Python-разработчик", min: 320000, max: 450000, stack: "Python, Django, Kafka", question: "Какую самую сложную задачу вы решили?",
    text: "Ищем сильного разработчика в команду ядра: Django, Kafka, PostgreSQL. Вы проектируете сервисы, менторите коллег и отвечаете за качество. Нужен опыт от пяти лет. Удалённо или офис в Москве." },
};

const stop = await startServer();
const browser = await chromium.launch();
try {
  const [c, e] = [await session(who.candidate), await session(who.employer)];
  await updateProfile(e, { name: COMPANY, description: "Продуктовая команда: делаем сервисы для логистики. Тестовая компания." });
  const profile = await updateProfile(c, {
    name: "Анна Тестова", primary_skills: ["Python", "Django"], skills: ["Python", "Django", "PostgreSQL", "Redis", "Docker"],
    pref_directions: ["backend"], experience_years: 4, leads_people: false, pref_level: "middle", level_source: "manual",
    pref_formats: ["remote"], pref_format: "remote", pref_city: "Москва", pref_salary: 250000,
    description: "Python-разработчик, четыре года опыта: Django, PostgreSQL, очереди. Тестовый профиль.",
    resume_public: true, resume_headline: "Python-разработчик",
  });
  console.log("candidate role:", profile.role);

  const hrContext = await browser.newContext({ locale: "ru-RU" });
  const hr = await hrContext.newPage();
  await login(hr, who.employer);
  const ids = {};
  for (const [name, v] of Object.entries(VACANCIES)) ids[name] = await publish(hr, v);
  console.log("vacancies:", ids);

  const candContext = await browser.newContext({ locale: "ru-RU" });
  const cand = await candContext.newPage();
  await login(cand, who.candidate);
  await cand.route("**/api/cover-letter", route => route.fulfill({
    json: { text: "Здравствуйте! Пишу на Python четыре года: Django, PostgreSQL, очереди. Хочу в вашу команду.", source: "ai" },
  }));
  await apply(cand, ids.invited, VACANCIES.invited.question, "Четыре года, из них два — Django в продакшене.");
  await apply(cand, ids.pending, VACANCIES.pending.question, "Celery и Redis Streams, немного Kafka.");
  console.log("applied");

  await hr.goto(`${BASE_URL}/employer`);
  await hr.getByRole("button", { name: "Сначала новые" }).click();
  const card = hr.locator("div.glass").filter({ hasText: VACANCIES.invited.title }).first();
  await card.getByRole("button", { name: "Пригласить" }).click();
  await card.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(hr.getByText(/Приглашение отправлено/)).toBeVisible();
  await card.getByRole("link", { name: "Написать" }).click();
  const box = hr.getByLabel("Сообщение", { exact: true });
  await box.fill("Добрый день! Удобно созвониться завтра в 15:00?");
  await box.press("Enter");
  await expect(hr.getByRole("log")).toContainText("созвониться завтра");
  await cand.goto(`${BASE_URL}/messages`);
  const item = cand.getByRole("list", { name: "Диалоги" }).getByRole("button").filter({ hasText: VACANCIES.invited.title });
  await item.click();
  await cand.getByLabel("Сообщение", { exact: true }).fill("Да, удобно. Жду звонка.");
  await cand.getByRole("button", { name: "Отправить" }).click();
  await expect(cand.getByRole("log")).toContainText("Жду звонка");
  console.log("chat and invite done");

  writeFileSync(DATA, JSON.stringify({
    company: COMPANY, direction: "backend", vacancyId: ids.open, practiceVacancyId: ids.invited, pendingVacancyId: ids.pending,
    emptyQuery: "ъъъщщщ", filterQuery: "Python",
  }, null, 2) + "\n");
  console.log("data.json written");
} finally {
  await browser.close();
  stop();
}
